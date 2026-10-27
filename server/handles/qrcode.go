package handles

import (
	"strconv"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/conf"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
	qrcode "github.com/skip2/go-qrcode"
)

// QRCode 生成二维码图片（本地生成，不依赖任何外部服务）
// 用法：GET /api/public/qrcode?text=<待编码内容>&size=260
func QRCode(c *gin.Context) {
	text := strings.TrimSpace(c.Query("text"))
	if text == "" {
		c.String(400, "missing text")
		return
	}
	if len(text) > 2048 {
		c.String(400, "text too long")
		return
	}
	size := 260
	if v := c.Query("size"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n >= 120 && n <= 1024 {
			size = n
		}
	}
	png, err := qrcode.Encode(text, qrcode.Medium, size)
	if err != nil {
		c.String(500, "failed to generate qrcode")
		return
	}
	c.Header("Cache-Control", "public, max-age=3600")
	c.Data(200, "image/png", png)
}

// Disable2FA 关闭当前账号的两步验证
func Disable2FA(c *gin.Context) {
	user := c.Request.Context().Value(conf.UserKey).(*model.User)
	if user.IsGuest() {
		common.ErrorStrResp(c, model.GuestCannotGenerate2FA, 403)
		return
	}
	user.OtpSecret = ""
	if err := op.UpdateUser(user); err != nil {
		common.ErrorResp(c, err, 500)
		return
	}
	common.SuccessResp(c)
}
