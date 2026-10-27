package model

// 分组编号必须与原版前端 src/types/setting.ts 的 Group 枚举保持一致
const (
	SINGLE = iota
	SITE
	STYLE
	PREVIEW
	GLOBAL
	ARIA2
	INDEX
	SSO
	LDAP
	S3
	FTP
	TRAFFIC
	MEDIA
	TRANSCODE
)

const (
	PUBLIC = iota
	PRIVATE
	READONLY
	DEPRECATED
)

type SettingItem struct {
	Key            string `json:"key" gorm:"primaryKey" binding:"required"` // unique key
	Value          string `json:"value"`                                    // value
	MigrationValue string `json:"-" gorm:"-:all"`                           // deprecated value
	Help           string `json:"help"`                                     // help message
	Type           string `json:"type"`                                     // string, number, bool, select
	Options        string `json:"options"`                                  // values for select
	Group          int    `json:"group"`                                    // use to group setting in frontend
	Flag           int    `json:"flag"`                                     // 0 = public, 1 = private, 2 = readonly, 3 = deprecated, etc.
	Index          uint   `json:"index"`
}

func (s SettingItem) IsDeprecated() bool {
	return s.Flag == DEPRECATED
}
