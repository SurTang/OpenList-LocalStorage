package model

import "time"

// PasswordResetCode 一次性密码重置码。
// 由管理员在后台或命令行生成，用户在登录页「忘记密码」中使用，使用后立即失效。
type PasswordResetCode struct {
	ID        uint       `json:"id" gorm:"primaryKey"`
	Username  string     `json:"username" gorm:"index;size:128;not null"`
	CodeHash  string     `json:"-" gorm:"size:128;not null"`
	ExpiresAt time.Time  `json:"expires_at"`
	UsedAt    *time.Time `json:"used_at"`
	CreatedAt time.Time  `json:"created_at"`
}
