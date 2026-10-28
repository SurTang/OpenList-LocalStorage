package data

import (
	"strconv"

	"github.com/OpenListTeam/OpenList/v4/cmd/flags"
	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
	"github.com/pkg/errors"
	"gorm.io/gorm"
)

func initSettings() {
	initialSettingItems := InitialSettings()
	isActive := func(key string) bool {
		for _, item := range initialSettingItems {
			if item.Key == key {
				return true
			}
		}
		return false
	}
	// check deprecated
	settings, err := op.GetSettingItems()
	if err != nil {
		utils.Log.Fatalf("failed get settings: %+v", err)
	}
	settingMap := map[string]*model.SettingItem{}
	for _, v := range settings {
		if v.Key == "" {
			err := db.DeleteSettingItemByKey(v.Key)
			if err != nil {
				utils.Log.Errorf("failed delete setting with empty key: %+v", err)
			}
			continue
		}
		if !isActive(v.Key) && v.Flag != model.DEPRECATED {
			v.Flag = model.DEPRECATED
			err = op.SaveSettingItem(&v)
			if err != nil {
				utils.Log.Fatalf("failed save setting: %+v", err)
			}
		}
		settingMap[v.Key] = &v
	}
	op.MigrationSettingItems = map[string]op.MigrationValueItem{}
	// create or save setting
	var saveItems []model.SettingItem
	for i := range initialSettingItems {
		item := &initialSettingItems[i]
		item.Index = uint(i)
		migrationValue := item.MigrationValue
		if len(migrationValue) > 0 {
			op.MigrationSettingItems[item.Key] = op.MigrationValueItem{MigrationValue: item.MigrationValue, Value: item.Value}
			item.MigrationValue = ""
		}
		// err
		stored, ok := settingMap[item.Key]
		if !ok {
			stored, err = op.GetSettingItemByKey(item.Key)
			if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
				utils.Log.Fatalf("failed get setting: %+v", err)
				continue
			}
		}
		if item.Key != conf.VERSION && stored != nil &&
			(len(migrationValue) == 0 || stored.Value != migrationValue) {
			item.Value = stored.Value
		}
		_, err = op.HandleSettingItemHook(item)
		if err != nil {
			utils.Log.Errorf("failed to execute hook on %s: %+v", item.Key, err)
			continue
		}
		if stored == nil || *item != *stored {
			saveItems = append(saveItems, *item)
		}
	}
	if len(saveItems) > 0 {
		err = db.SaveSettingItems(saveItems)
		if err != nil {
			utils.Log.Fatalf("failed save setting: %+v", err)
		} else {
			op.SettingCacheUpdate()
		}
	}
}

// InitialSettings 返回本项目的全部设置项。
// 只保留三类可视化设置：样式（STYLE）、预览（PREVIEW）、全局（GLOBAL）。
func InitialSettings() []model.SettingItem {
	var token string
	if flags.Dev {
		token = "dev_token"
	} else {
		token = random.Token()
	}
	siteVersion := conf.Version
	items := []model.SettingItem{
		// ===== 站点 =====
		{Key: conf.VERSION, Value: siteVersion, Type: conf.TypeString, Group: model.SITE, Flag: model.READONLY},
		{Key: conf.SiteTitle, Value: "文件服务器", Type: conf.TypeString, Group: model.SITE},
		{Key: conf.Announcement, Value: "欢迎使用文件服务器。所有存储均位于本地网络，可自由浏览、上传与分享文件。", Type: conf.TypeText, Group: model.SITE},
		{Key: conf.PaginationType, Value: "pagination", Type: conf.TypeSelect, Options: "all,pagination,load_more,auto_load_more", Group: model.SITE},
		{Key: conf.DefaultPageSize, Value: "30", Type: conf.TypeNumber, Group: model.SITE},
		{Key: conf.AllowIndexed, Value: "false", Type: conf.TypeBool, Group: model.SITE},
		{Key: conf.AllowMounted, Value: "true", Type: conf.TypeBool, Group: model.SITE},
		{Key: conf.RobotsTxt, Value: "User-agent: *\nAllow: /", Type: conf.TypeText, Group: model.SITE},
		{Key: conf.GuestLoginEntry, Value: "true", Type: conf.TypeBool, Group: model.SITE, Flag: model.PUBLIC,
			Help: "开启访客模式后，首页右上角仍显示登录入口；关闭后访客只能浏览，无法从首页进入登录页。"},
		{Key: conf.PasswordResetEnabled, Value: "true", Type: conf.TypeBool, Group: model.SITE, Flag: model.PUBLIC,
			Help: "允许用户使用管理员生成的一次性重置码在登录页自助找回密码。"},
		{Key: conf.HideFiles, Value: "/\\/README.md/i", Type: conf.TypeText, Group: model.GLOBAL},
		{Key: conf.PackageDownload, Value: "true", Type: conf.TypeBool, Group: model.GLOBAL},
		{Key: conf.CustomizeHead, Type: conf.TypeText, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.CustomizeBody, Type: conf.TypeText, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.LinkExpiration, Value: "0", Type: conf.TypeNumber, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.SignAll, Value: "true", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.OcrApi, Value: "/api/public/ocr", Type: conf.TypeString, Group: model.GLOBAL,
			Help: "OCR 接口地址。默认使用内置本地 OCR（/api/public/ocr），不依赖任何外部网络服务。"},
		{Key: conf.FilenameCharMapping, Value: `{"/": "|"}`, Type: conf.TypeText, Group: model.GLOBAL},
		{Key: conf.ForwardDirectLinkParams, Value: "false", Type: conf.TypeBool, Group: model.GLOBAL},
		{Key: conf.IgnoreDirectLinkParams, Value: "sign,openlist_ts,raw", Type: conf.TypeString, Group: model.GLOBAL},
		{Key: conf.SharePreview, Value: "true", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PUBLIC},
		{Key: conf.ShareArchivePreview, Value: "false", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PUBLIC},
		{Key: conf.ShareForceProxy, Value: "true", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.ShareSummaryContent, Value: "{{creator}} 分享了 {{filename}}，来自 {{site_title}}：{{base_url}}/@s/{{id}}{{#if pwd}}，提取码 {{pwd}}{{/if}}", Type: conf.TypeText, Group: model.GLOBAL, Flag: model.PUBLIC},
		{Key: conf.HandleHookAfterWriting, Value: "false", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.HandleHookRateLimit, Value: "0", Type: conf.TypeNumber, Group: model.GLOBAL, Flag: model.PRIVATE},
		{Key: conf.IgnoreSystemFiles, Value: "false", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PRIVATE,
			Help: "上传时忽略系统文件（.DS_Store、desktop.ini、Thumbs.db 以及以 ._ 开头的文件）"},

		// ===== 流量 =====
		{Key: conf.MultipartEnabled, Value: "true", Type: conf.TypeBool, Group: model.GLOBAL, Flag: model.PUBLIC},
		{Key: conf.MultipartChunkSize, Value: "10", Type: conf.TypeNumber, Group: model.GLOBAL, Flag: model.PUBLIC,
			Help: "分片上传的单片大小（MB），需低于反向代理的请求体上限"},
		{Key: conf.TaskUploadThreadsNum, Value: strconv.Itoa(conf.Conf.Tasks.Upload.Workers), Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.TaskCopyThreadsNum, Value: strconv.Itoa(conf.Conf.Tasks.Copy.Workers), Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.TaskMoveThreadsNum, Value: strconv.Itoa(conf.Conf.Tasks.Move.Workers), Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.TaskDecompressDownloadThreadsNum, Value: strconv.Itoa(conf.Conf.Tasks.Decompress.Workers), Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.TaskDecompressUploadThreadsNum, Value: strconv.Itoa(conf.Conf.Tasks.DecompressUpload.Workers), Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.StreamMaxClientDownloadSpeed, Value: "-1", Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.StreamMaxClientUploadSpeed, Value: "-1", Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.StreamMaxServerDownloadSpeed, Value: "-1", Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},
		{Key: conf.StreamMaxServerUploadSpeed, Value: "-1", Type: conf.TypeNumber, Group: model.TRAFFIC, Flag: model.PRIVATE},

		// ===== 索引 =====
		{Key: conf.SearchIndex, Value: "database", Type: conf.TypeSelect, Options: "database,database_non_full_text,none", Group: model.INDEX},
		{Key: conf.AutoUpdateIndex, Value: "false", Type: conf.TypeBool, Group: model.INDEX},
		{Key: conf.IgnorePaths, Value: "", Type: conf.TypeText, Group: model.INDEX, Flag: model.PRIVATE, Help: "每行一个路径"},
		{Key: conf.MaxIndexDepth, Value: "20", Type: conf.TypeNumber, Group: model.INDEX, Flag: model.PRIVATE, Help: "索引最大深度"},

		// ===== FTP / SFTP 服务端 =====
		{Key: conf.FTPPublicHost, Value: "127.0.0.1", Type: conf.TypeString, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.FTPPasvPortMap, Value: "", Type: conf.TypeText, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.FTPMandatoryTLS, Value: "false", Type: conf.TypeBool, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.FTPImplicitTLS, Value: "false", Type: conf.TypeBool, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.FTPTLSPrivateKeyPath, Value: "", Type: conf.TypeString, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.FTPTLSPublicCertPath, Value: "", Type: conf.TypeString, Group: model.FTP, Flag: model.PRIVATE},
		{Key: conf.SFTPDisablePasswordLogin, Value: "false", Type: conf.TypeBool, Group: model.FTP, Flag: model.PRIVATE},

		// ===== 内部使用 =====
		{Key: conf.Token, Value: token, Type: conf.TypeString, Group: model.SINGLE, Flag: model.PRIVATE},
		{Key: conf.IndexProgress, Value: "{}", Type: conf.TypeText, Group: model.SINGLE, Flag: model.PRIVATE},

		// ===== 样式 =====
		{Key: conf.Logo, Value: "/assets/images/logo.svg", Type: conf.TypeText, Group: model.STYLE},
		{Key: conf.Favicon, Value: "/assets/images/favicon.svg", Type: conf.TypeString, Group: model.STYLE},
		{Key: conf.MainColor, Value: "#2563eb", Type: conf.TypeString, Group: model.STYLE},
		{Key: conf.HomeIcon, Value: "/assets/icons/home.svg", Type: conf.TypeString, Group: model.STYLE,
			Help: "首页按钮图标，可填本地图标路径；留空或 emoji 时使用内置线性图标"},
		{Key: conf.ShareIcon, Value: "🎁", Type: conf.TypeString, Group: model.STYLE,
			Help: "分享按钮图标，可填本地图标路径或单个 emoji"},
		{Key: conf.HideStorageDetails, Value: "true", Type: conf.TypeBool, Group: model.STYLE, Flag: model.PRIVATE},
		{Key: conf.HideStorageDetailsInManagePage, Value: "true", Type: conf.TypeBool, Group: model.STYLE, Flag: model.PRIVATE},

		// ===== 预览 =====
		{Key: conf.TextTypes, Value: "txt,htm,html,xml,java,properties,sql,js,md,json,conf,ini,vue,php,py,bat,gitignore,yml,go,sh,c,cpp,h,hpp,tsx,vtt,srt,ass,rs,lrc,strm", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.AudioTypes, Value: "mp3,flac,ogg,m4a,wav,opus,wma", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.VideoTypes, Value: "mp4,mkv,avi,mov,rmvb,webm,flv,m3u8", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.ImageTypes, Value: "jpg,tiff,jpeg,png,gif,bmp,svg,ico,swf,webp,avif", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.ProxyTypes, Value: "m3u8,url", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.ProxyIgnoreHeaders, Value: "authorization,referer", Type: conf.TypeText, Group: model.PREVIEW, Flag: model.PRIVATE},
		{Key: conf.ExternalPreviews, Value: "{}", Type: conf.TypeText, Group: model.PREVIEW},
		{Key: conf.AudioCover, Value: "/assets/images/audio-cover.svg", Type: conf.TypeString, Group: model.PREVIEW,
			Help: "音频预览的默认封面，默认使用本地内置资源"},
		{Key: conf.AudioAutoplay, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.VideoAutoplay, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.PreviewDownloadByDefault, Value: "false", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.PreviewArchivesByDefault, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.SharePreviewDownloadByDefault, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.SharePreviewArchivesByDefault, Value: "false", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.ReadMeAutoRender, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.FilterReadMeScripts, Value: "true", Type: conf.TypeBool, Group: model.PREVIEW},
		{Key: conf.NonEFSZipEncoding, Value: "IBM437", Type: conf.TypeString, Group: model.PREVIEW},
	}
	return items
}
