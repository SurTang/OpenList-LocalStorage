// Package pwdreset 提供不依赖任何外部服务的密码找回能力。
//
// 流程：
//  1. 管理员在后台「用户管理」或命令行生成一次性重置码（默认 15 分钟有效）；
//  2. 用户在登录页「忘记密码」中输入用户名 + 重置码 + 新密码；
//  3. 校验通过后立即修改密码，重置码作废。
package pwdreset

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/db"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils/random"
)

// DefaultTTL 重置码默认有效期
const DefaultTTL = 15 * time.Minute

// ErrInvalid 表示用户名或重置码不正确
var ErrInvalid = errors.New("用户名或重置码不正确，或重置码已过期")

// ErrTooShort 表示新密码太短
var ErrTooShort = errors.New("新密码长度至少为 6 位")

func hashCode(username, code string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(username)) + "|" + normalizeCode(code)))
	return hex.EncodeToString(sum[:])
}

// normalizeCode 去掉分隔符与空格并转为大写，便于用户输入
func normalizeCode(code string) string {
	replacer := strings.NewReplacer("-", "", " ", "", "\t", "")
	return strings.ToUpper(replacer.Replace(strings.TrimSpace(code)))
}

// Generate 为用户生成一次性重置码，返回明文码与过期时间
func Generate(username string, ttl time.Duration) (string, time.Time, error) {
	username = strings.TrimSpace(username)
	if username == "" {
		return "", time.Time{}, errors.New("用户名不能为空")
	}
	if _, err := op.GetUserByName(username); err != nil {
		return "", time.Time{}, errors.New("用户不存在")
	}
	if ttl <= 0 {
		ttl = DefaultTTL
	}
	raw := strings.ToUpper(random.String(8))
	// 简单格式化，便于抄写
	code := raw[0:4] + "-" + raw[4:8]
	expires := time.Now().Add(ttl)
	if err := db.DeleteResetCodes(username); err != nil {
		return "", time.Time{}, err
	}
	item := &model.PasswordResetCode{
		Username:  username,
		CodeHash:  hashCode(username, code),
		ExpiresAt: expires,
	}
	if err := db.CreateResetCode(item); err != nil {
		return "", time.Time{}, err
	}
	return code, expires, nil
}

// Reset 校验重置码并修改密码
func Reset(username, code, newPassword string) error {
	username = strings.TrimSpace(username)
	if len(newPassword) < 6 {
		return ErrTooShort
	}
	if username == "" || normalizeCode(code) == "" {
		return ErrInvalid
	}
	item, err := db.GetLatestResetCode(username)
	if err != nil {
		return ErrInvalid
	}
	expect := hashCode(username, code)
	if subtle.ConstantTimeCompare([]byte(item.CodeHash), []byte(expect)) != 1 {
		return ErrInvalid
	}
	user, err := op.GetUserByName(username)
	if err != nil {
		return ErrInvalid
	}
	user.SetPassword(newPassword)
	if err := op.UpdateUser(user); err != nil {
		return err
	}
	_ = db.UseResetCode(item.ID)
	return nil
}
