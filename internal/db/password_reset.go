package db

import (
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/pkg/errors"
)

// DeleteResetCodes 清理某个用户的全部重置码
func DeleteResetCodes(username string) error {
	return errors.WithStack(db.Where("username = ?", username).Delete(&model.PasswordResetCode{}).Error)
}

// CreateResetCode 保存一条新的重置码记录
func CreateResetCode(item *model.PasswordResetCode) error {
	return errors.WithStack(db.Create(item).Error)
}

// GetLatestResetCode 取出该用户最新一条未使用且未过期的重置码
func GetLatestResetCode(username string) (*model.PasswordResetCode, error) {
	var item model.PasswordResetCode
	err := db.Where("username = ? AND used_at IS NULL AND expires_at > ?", username, time.Now()).
		Order(columnName("id")+" DESC").First(&item).Error
	if err != nil {
		return nil, errors.WithStack(err)
	}
	return &item, nil
}

// UseResetCode 标记重置码已使用
func UseResetCode(id uint) error {
	now := time.Now()
	return errors.WithStack(db.Model(&model.PasswordResetCode{}).Where("id = ?", id).
		Updates(map[string]interface{}{"used_at": &now}).Error)
}
