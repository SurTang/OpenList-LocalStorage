package common

import (
	"context"
	"fmt"
	"io"
	"net/http"
	stdpath "path"
	"strings"

	"maps"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/net"
	"github.com/OpenListTeam/OpenList/v4/internal/sign"
	"github.com/OpenListTeam/OpenList/v4/internal/stream"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
)

func Proxy(w http.ResponseWriter, r *http.Request, link *model.Link, file model.Obj) error {
	inline := isInlineRequest(r, file)
	// if link.MFile != nil {
	// 	attachHeader(w, file, link)
	// 	http.ServeContent(w, r, file.GetName(), file.ModTime(), link.MFile)
	// 	return nil
	// }

	if link.Concurrency > 0 || link.PartSize > 0 {
		attachHeader(w, file, link, inline)
		size := link.ContentLength
		if size <= 0 {
			size = file.GetSize()
		}
		rrf, _ := stream.GetRangeReaderFromLink(size, link)
		if link.RangeReader == nil {
			r = r.WithContext(context.WithValue(r.Context(), conf.RequestHeaderKey, r.Header))
		}
		return net.ServeHTTP(w, r, file.GetName(), file.ModTime(), size, rrf)
	}

	if link.RangeReader != nil {
		attachHeader(w, file, link, inline)
		size := link.ContentLength
		if size <= 0 {
			size = file.GetSize()
		}
		return net.ServeHTTP(w, r, file.GetName(), file.ModTime(), size, link.RangeReader)
	}

	//transparent proxy
	header := net.ProcessHeader(r.Header, link.Header)
	res, err := net.RequestHttp(r.Context(), r.Method, header, link.URL)
	if err != nil {
		return err
	}
	defer res.Body.Close()

	maps.Copy(w.Header(), res.Header)
	disposition := utils.GenerateContentDisposition(file.GetName())
	if inline {
		disposition = "inline" + strings.TrimPrefix(disposition, "attachment")
	}
	w.Header().Set("Content-Disposition", disposition)
	w.WriteHeader(res.StatusCode)
	if r.Method == http.MethodHead {
		return nil
	}
	_, err = utils.CopyWithBuffer(w, &stream.RateLimitReader{
		Reader:  res.Body,
		Limiter: stream.ServerDownloadLimit,
		Ctx:     r.Context(),
	})
	return err
}

func isInlineRequest(r *http.Request, file model.Obj) bool {
	v := r.URL.Query().Get("inline")
	return (v == "1" || v == "true") && CanInline(file.GetName())
}

// CanInline 限制可内联响应的类型，避免用户上传的 HTML/SVG 在同一源执行脚本。
func CanInline(fileName string) bool {
	switch strings.ToLower(stdpath.Ext(fileName)) {
	case ".pdf",
		".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".avif", ".ico", ".tif", ".tiff",
		".mp4", ".webm", ".mkv", ".mov", ".m4v", ".ogv",
		".mp3", ".flac", ".wav", ".m4a", ".ogg", ".opus", ".aac":
		return true
	}
	return false
}

func attachHeader(w http.ResponseWriter, file model.Obj, link *model.Link, inline bool) {
	fileName := file.GetName()
	disposition := utils.GenerateContentDisposition(fileName)
	if inline {
		disposition = "inline" + strings.TrimPrefix(disposition, "attachment")
	}
	w.Header().Set("Content-Disposition", disposition)
	w.Header().Set("Content-Type", utils.GetMimeType(fileName))
	size := link.ContentLength
	if size <= 0 {
		size = file.GetSize()
	}
	w.Header().Set("Etag", GetEtag(file, size))
	contentType := link.Header.Get("Content-Type")
	if len(contentType) > 0 {
		w.Header().Set("Content-Type", contentType)
	} else {
		w.Header().Set("Content-Type", utils.GetMimeType(fileName))
	}
}
func GetEtag(file model.Obj, size int64) string {
	hash := ""
	for _, v := range file.GetHash().Export() {
		if v > hash {
			hash = v
		}
	}
	if len(hash) > 0 {
		return fmt.Sprintf(`"%s"`, hash)
	}
	// Storage backends may not preserve sub-second timestamps across cache
	// refreshes, so only use the reproducible second precision here.
	return fmt.Sprintf(`"%x-%x"`, file.ModTime().Unix(), size)
}

func ProxyRange(ctx context.Context, link *model.Link, size int64) *model.Link {
	if link.RangeReader == nil && !strings.HasPrefix(link.URL, GetApiUrl(ctx)+"/") {
		if link.ContentLength > 0 {
			size = link.ContentLength
		}
		rrf, err := stream.GetRangeReaderFromLink(size, link)
		if err == nil {
			return &model.Link{
				RangeReader:   rrf,
				ContentLength: size,
			}
		}
	}
	return link
}

type InterceptResponseWriter struct {
	http.ResponseWriter
	io.Writer
}

func (iw *InterceptResponseWriter) Write(p []byte) (int, error) {
	return iw.Writer.Write(p)
}

type WrittenResponseWriter struct {
	http.ResponseWriter
	written bool
}

func (ww *WrittenResponseWriter) Write(p []byte) (int, error) {
	n, err := ww.ResponseWriter.Write(p)
	if !ww.written && n > 0 {
		ww.written = true
	}
	return n, err
}

func (ww *WrittenResponseWriter) IsWritten() bool {
	return ww.written
}

func GenerateDownProxyURL(storage *model.Storage, reqPath string) string {
	if storage.DownProxyURL == "" {
		return ""
	}
	query := ""
	if !storage.DisableProxySign {
		query = "?sign=" + sign.Sign(reqPath)
	}
	return fmt.Sprintf("%s%s%s",
		strings.Split(storage.DownProxyURL, "\n")[0],
		utils.EncodePath(reqPath, true),
		query,
	)
}
