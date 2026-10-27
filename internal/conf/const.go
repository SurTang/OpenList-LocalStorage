package conf

const (
	TypeString = "string"
	TypeSelect = "select"
	TypeBool   = "bool"
	TypeText   = "text"
	TypeNumber = "number"
)

const (
	// global / site
	VERSION      = "version"
	SiteTitle    = "site_title"
	Announcement = "announcement"
	AllowIndexed = "allow_indexed"
	AllowMounted = "allow_mounted"
	RobotsTxt    = "robots_txt"

	// style
	Logo                           = "logo" // multi-lines text, L1: light, EOL: dark
	Favicon                        = "favicon"
	MainColor                      = "main_color"
	HideStorageDetails             = "hide_storage_details"
	HideStorageDetailsInManagePage = "hide_storage_details_in_manage_page"

	// preview
	TextTypes                     = "text_types"
	AudioTypes                    = "audio_types"
	VideoTypes                    = "video_types"
	ImageTypes                    = "image_types"
	ProxyTypes                    = "proxy_types"
	ProxyIgnoreHeaders            = "proxy_ignore_headers"
	AudioAutoplay                 = "audio_autoplay"
	VideoAutoplay                 = "video_autoplay"
	PreviewDownloadByDefault      = "preview_download_by_default"
	PreviewArchivesByDefault      = "preview_archives_by_default"
	SharePreviewDownloadByDefault = "share_preview_download_by_default"
	SharePreviewArchivesByDefault = "share_preview_archives_by_default"
	ReadMeAutoRender              = "readme_autorender"
	FilterReadMeScripts           = "filter_readme_scripts"
	NonEFSZipEncoding             = "non_efs_zip_encoding"

	// global
	HideFiles               = "hide_files"
	PackageDownload         = "package_download"
	CustomizeHead           = "customize_head"
	CustomizeBody           = "customize_body"
	LinkExpiration          = "link_expiration"
	SignAll                 = "sign_all"
	PrivacyRegs             = "privacy_regs"
	OcrApi                  = "ocr_api"
	FilenameCharMapping     = "filename_char_mapping"
	ForwardDirectLinkParams = "forward_direct_link_params"
	IgnoreDirectLinkParams  = "ignore_direct_link_params"
	SharePreview            = "share_preview"
	ShareArchivePreview     = "share_archive_preview"
	ShareForceProxy         = "share_force_proxy"
	ShareSummaryContent     = "share_summary_content"
	HandleHookAfterWriting  = "handle_hook_after_writing"
	HandleHookRateLimit     = "handle_hook_rate_limit"
	IgnoreSystemFiles       = "ignore_system_files"

	// 本项目的定制设置项
	GuestLoginEntry      = "guest_login_entry"      // 访客模式下是否在首页右上角显示登录入口
	PasswordResetEnabled = "password_reset_enabled" // 是否允许用户通过重置码自助找回密码
	DefaultPageSize      = "default_page_size"
	PaginationType       = "pagination_type"
	HomeIcon             = "home_icon"
	ShareIcon            = "share_icon"
	AudioCover           = "audio_cover"
	ExternalPreviews     = "external_previews"

	// index
	SearchIndex     = "search_index"
	AutoUpdateIndex = "auto_update_index"
	IgnorePaths     = "ignore_paths"
	MaxIndexDepth   = "max_index_depth"

	// single
	Token         = "token"
	IndexProgress = "index_progress"

	// ftp / sftp server
	FTPPublicHost            = "ftp_public_host"
	FTPPasvPortMap           = "ftp_pasv_port_map"
	FTPMandatoryTLS          = "ftp_mandatory_tls"
	FTPImplicitTLS           = "ftp_implicit_tls"
	FTPTLSPrivateKeyPath     = "ftp_tls_private_key_path"
	FTPTLSPublicCertPath     = "ftp_tls_public_cert_path"
	SFTPDisablePasswordLogin = "sftp_disable_password_login"

	// traffic / tasks
	TaskUploadThreadsNum             = "upload_task_threads_num"
	TaskCopyThreadsNum               = "copy_task_threads_num"
	TaskMoveThreadsNum               = "move_task_threads_num"
	TaskDecompressDownloadThreadsNum = "decompress_download_task_threads_num"
	TaskDecompressUploadThreadsNum   = "decompress_upload_task_threads_num"
	StreamMaxClientDownloadSpeed     = "max_client_download_speed"
	StreamMaxClientUploadSpeed       = "max_client_upload_speed"
	StreamMaxServerDownloadSpeed     = "max_server_download_speed"
	StreamMaxServerUploadSpeed       = "max_server_upload_speed"

	// multipart upload
	MultipartEnabled   = "multipart_enabled"
	MultipartChunkSize = "multipart_chunk_size"
)

const (
	UNKNOWN = iota
	FOLDER
	VIDEO
	AUDIO
	TEXT
	IMAGE
)

// ContextKey is the type of context keys.
type ContextKey int8

const (
	_ ContextKey = iota

	NoTaskKey
	ApiUrlKey
	UserKey
	MetaKey
	MetaPassKey
	ClientIPKey
	ProxyHeaderKey
	RequestHeaderKey
	UserAgentKey
	PathKey
	SharingIDKey
	SkipHookKey
	DirectUploadContentTypeKey
	SkipNoOverwriteKey
	ThumbnailBaseURLKey
)
