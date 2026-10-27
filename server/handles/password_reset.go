package handles

import (
	"strings"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/pwdreset"
	"github.com/OpenListTeam/OpenList/v4/internal/setting"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

type resetPasswordReq struct {
	Username string `json:"username" binding:"required"`
	Code     string `json:"code" binding:"required"`
	Password string `json:"password" binding:"required"`
}

type genResetCodeReq struct {
	Username string `json:"username" binding:"required"`
}

// ResetPasswordInfo 返回登录页「忘记密码」所需的公开开关
func ResetPasswordInfo(c *gin.Context) {
	common.SuccessResp(c, gin.H{
		"enabled": setting.GetBool(conf.PasswordResetEnabled),
	})
}

// ResetPassword 使用一次性重置码修改密码（无需登录）
func ResetPassword(c *gin.Context) {
	if !setting.GetBool(conf.PasswordResetEnabled) {
		common.ErrorStrResp(c, "本站已关闭自助找回密码，请联系管理员重置", 403)
		return
	}
	var req resetPasswordReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	if err := pwdreset.Reset(strings.TrimSpace(req.Username), req.Code, req.Password); err != nil {
		common.ErrorStrResp(c, err.Error(), 400)
		return
	}
	common.SuccessResp(c, gin.H{"message": "密码已重置，请使用新密码登录"})
}

// AdminGenResetCode 管理员为用户生成一次性重置码
func AdminGenResetCode(c *gin.Context) {
	var req genResetCodeReq
	if err := c.ShouldBind(&req); err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	code, expires, err := pwdreset.Generate(req.Username, pwdreset.DefaultTTL)
	if err != nil {
		common.ErrorResp(c, err, 400)
		return
	}
	common.SuccessResp(c, gin.H{
		"code":       code,
		"expires_at": expires.Format(time.RFC3339),
		"ttl_minute": int(pwdreset.DefaultTTL.Minutes()),
	})
}
