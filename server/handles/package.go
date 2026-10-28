package handles

import (
	"archive/zip"
	"context"
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	stdpath "path"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/errs"
	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/pkg/http_range"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	"github.com/pkg/errors"
	log "github.com/sirupsen/logrus"
)

type PackageItem struct {
	Path     string `json:"path"`
	Password string `json:"password"`
}

type PackageReq struct {
	Items []PackageItem `json:"items" binding:"required,min=1,max=200"`
	Name  string        `json:"name"`
}

type packageTicket struct {
	User      model.User
	Items     []PackageItem
	Name      string
	ExpiresAt time.Time
}

type packageEntry struct {
	RequestPath string
	ArchivePath string
	Obj         model.Obj
}

var packageTickets sync.Map

func FsPackageTicket(c *gin.Context) {
	if !setting.GetBool(conf.PackageDownload) {
		common.ErrorStrResp(c, "打包下载已被管理员关闭", 403)
		return
	}
	var req PackageReq
	if err := c.ShouldBindJSON(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	for _, item := range req.Items {
		if item.Path == "" || strings.HasPrefix(item.Path, "/@s/") {
			common.ErrorStrResp(c, "打包路径无效", 400)
			return
		}
		if _, _, err := collectPackagePath(c.Request.Context(), user, item); err != nil {
			common.ErrorResp(c, err, 403)
			return
		}
	}
	buf := make([]byte, 24)
	if _, err := rand.Read(buf); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	now := time.Now()
	packageTickets.Range(func(key, value any) bool {
		if value.(packageTicket).ExpiresAt.Before(now) {
			packageTickets.Delete(key)
		}
		return true
	})
	id := hex.EncodeToString(buf)
	packageTickets.Store(id, packageTicket{User: *user, Items: req.Items, Name: req.Name, ExpiresAt: now.Add(2 * time.Minute)})
	common.SuccessResp(c, gin.H{"ticket": id, "expires_in": 120})
}

// collectPackagePath 在返回响应头前完成路径、密码和权限校验。
func collectPackagePath(ctx context.Context, user *model.User, item PackageItem) (string, model.Obj, error) {
	reqPath, err := user.JoinPath(item.Path)
	if err != nil {
		return "", nil, err
	}
	meta, err := op.GetNearestMeta(reqPath)
	if err != nil && !errors.Is(errors.Cause(err), errs.MetaNotFound) {
		return "", nil, err
	}
	if !common.CanAccess(user, meta, reqPath, item.Password) {
		return "", nil, errors.New("密码不正确或没有访问权限：" + item.Path)
	}
	obj, err := fs.Get(ctx, reqPath, &fs.GetArgs{})
	if err != nil {
		return "", nil, err
	}
	return reqPath, obj, nil
}

func uniquePackageRoot(name string, used map[string]int) string {
	name = strings.Trim(strings.NewReplacer("\\", "_", "/", "_").Replace(name), "/ .")
	if name == "" {
		name = "文件"
	}
	if used[name] == 0 {
		used[name] = 1
		return name
	}
	ext := stdpath.Ext(name)
	base := strings.TrimSuffix(name, ext)
	for i := 2; ; i++ {
		candidate := fmt.Sprintf("%s_%d%s", base, i, ext)
		if used[candidate] == 0 {
			used[candidate] = 1
			return candidate
		}
	}
}

func walkPackage(ctx context.Context, reqPath string, obj model.Obj, archivePath string, entries *[]packageEntry) error {
	if len(*entries) >= 50000 {
		return errors.New("打包文件数量超过 50000，请分批下载")
	}
	*entries = append(*entries, packageEntry{RequestPath: reqPath, ArchivePath: archivePath, Obj: obj})
	if !obj.IsDir() {
		return nil
	}
	objs, err := fs.List(ctx, reqPath, &fs.ListArgs{})
	if err != nil {
		return fmt.Errorf("读取目录 %s 失败：%w", reqPath, err)
	}
	for _, child := range objs {
		childPath := stdpath.Join(reqPath, child.GetName())
		childArchive := stdpath.Join(archivePath, child.GetName())
		if child.IsDir() {
			childArchive += "/"
		}
		if err := walkPackage(ctx, childPath, child, childArchive, entries); err != nil {
			return err
		}
	}
	return nil
}

func buildPackageEntries(ctx context.Context, ticket packageTicket) ([]packageEntry, error) {
	entries := make([]packageEntry, 0)
	usedRoots := make(map[string]int)
	for _, item := range ticket.Items {
		reqPath, obj, err := collectPackagePath(ctx, &ticket.User, item)
		if err != nil {
			return nil, err
		}
		root := uniquePackageRoot(obj.GetName(), usedRoots)
		archivePath := root
		if obj.IsDir() {
			archivePath += "/"
		}
		if err := walkPackage(ctx, reqPath, obj, archivePath, &entries); err != nil {
			return nil, err
		}
	}
	return entries, nil
}

func writePackageFile(ctx context.Context, c *gin.Context, zw *zip.Writer, entry packageEntry) error {
	header := &zip.FileHeader{Name: entry.ArchivePath, Method: zip.Store}
	header.SetModTime(entry.Obj.ModTime())
	if entry.Obj.IsDir() {
		_, err := zw.CreateHeader(header)
		return err
	}
	link, _, err := fs.Link(ctx, entry.RequestPath, model.LinkArgs{IP: c.ClientIP(), Header: c.Request.Header})
	if err != nil {
		return err
	}
	defer link.Close()
	rr, err := stream.GetRangeReaderFromLink(entry.Obj.GetSize(), link)
	if err != nil {
		return err
	}
	rc, err := rr.RangeRead(ctx, http_range.Range{Start: 0, Length: -1})
	if err != nil {
		return err
	}
	defer rc.Close()
	writer, err := zw.CreateHeader(header)
	if err != nil {
		return err
	}
	_, err = io.Copy(writer, rc)
	return err
}

func FsPackageDownload(c *gin.Context) {
	ticketID := c.Query("ticket")
	value, ok := packageTickets.LoadAndDelete(ticketID)
	if !ok {
		c.String(404, "打包链接无效或已使用")
		return
	}
	ticket := value.(packageTicket)
	if ticket.ExpiresAt.Before(time.Now()) {
		c.String(403, "打包链接已过期，请重新生成")
		return
	}
	entries, err := buildPackageEntries(c.Request.Context(), ticket)
	if err != nil {
		c.String(500, "打包失败：%s", err.Error())
		return
	}
	name := strings.TrimSpace(ticket.Name)
	if name == "" {
		name = "打包下载"
	}
	name = strings.Map(func(r rune) rune {
		if strings.ContainsRune(`\\/:*?"<>|`, r) {
			return '_'
		}
		return r
	}, name) + "_" + time.Now().Format("20060102") + ".zip"
	c.Header("Content-Type", "application/zip")
	c.Header("Content-Disposition", utils.GenerateContentDisposition(name))
	c.Header("X-Content-Type-Options", "nosniff")
	c.Status(200)
	zw := zip.NewWriter(c.Writer)
	for _, entry := range entries {
		if err := writePackageFile(c.Request.Context(), c, zw, entry); err != nil {
			log.Errorf("package download %s: %+v", entry.RequestPath, err)
			_ = zw.Close()
			return
		}
		if flusher, ok := c.Writer.(interface{ Flush() }); ok {
			flusher.Flush()
		}
	}
	if err := zw.Close(); err != nil {
		log.Errorf("finish package download: %+v", err)
	}
}
