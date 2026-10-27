package cmd

import (
	"fmt"
	"strings"

	"github.com/OpenListTeam/OpenList/v4/internal/bootstrap"
	"github.com/OpenListTeam/OpenList/v4/internal/op"
	"github.com/OpenListTeam/OpenList/v4/internal/pwdreset"
	"github.com/OpenListTeam/OpenList/v4/pkg/utils"
	"github.com/spf13/cobra"
)

// reset-password：管理员重置任意用户的密码（本地运维手段，无需登录）
var ResetUserPasswordCmd = &cobra.Command{
	Use:   "reset-password",
	Short: "重置任意用户的登录密码",
	Long: `重置任意用户的登录密码。

示例：
  openlist admin reset-password --username admin --password 12345678
  openlist admin reset-password -u zhangsan -p 12345678`,
	RunE: func(cmd *cobra.Command, args []string) error {
		username, _ := cmd.Flags().GetString("username")
		password, _ := cmd.Flags().GetString("password")
		username = strings.TrimSpace(username)
		if username == "" && len(args) > 0 {
			username = strings.TrimSpace(args[0])
		}
		if username == "" {
			return fmt.Errorf("请通过 --username 指定用户名")
		}
		if password == "" && len(args) > 1 {
			password = args[1]
		}
		if len(password) < 6 {
			return fmt.Errorf("新密码长度至少为 6 位")
		}
		bootstrap.Init()
		defer bootstrap.Release()
		user, err := op.GetUserByName(username)
		if err != nil {
			return fmt.Errorf("用户 %s 不存在", username)
		}
		user.SetPassword(password)
		if err = op.UpdateUser(user); err != nil {
			return err
		}
		fmt.Printf("用户 %s 的密码已重置。\n", username)
		fmt.Println("请使用新密码登录，并妥善保管。")
		return nil
	},
}

// reset-code：为用户生成一次性重置码，用于 Web 登录页的「忘记密码」
var ResetCodeCmd = &cobra.Command{
	Use:   "reset-code",
	Short: "为用户生成一次性密码重置码（用于登录页忘记密码）",
	Long: `为用户生成一次性密码重置码，默认 15 分钟内有效、使用一次后立即失效。

示例：
  openlist admin reset-code --username zhangsan`,
	RunE: func(cmd *cobra.Command, args []string) error {
		username, _ := cmd.Flags().GetString("username")
		username = strings.TrimSpace(username)
		if username == "" && len(args) > 0 {
			username = strings.TrimSpace(args[0])
		}
		if username == "" {
			return fmt.Errorf("请通过 --username 指定用户名")
		}
		bootstrap.Init()
		defer bootstrap.Release()
		code, expires, err := pwdreset.Generate(username, pwdreset.DefaultTTL)
		if err != nil {
			return err
		}
		utils.Log.Infof("generated password reset code for %s", username)
		fmt.Printf("用户名: %s\n", username)
		fmt.Printf("重置码: %s\n", code)
		fmt.Printf("有效期至: %s\n", expires.Format("2006-01-02 15:04:05"))
		fmt.Println("请在登录页点击「忘记密码」，输入用户名、重置码与新密码完成重置。")
		return nil
	},
}

func init() {
	AdminCmd.AddCommand(ResetUserPasswordCmd)
	AdminCmd.AddCommand(ResetCodeCmd)
	ResetUserPasswordCmd.Flags().StringP("username", "u", "", "要重置密码的用户名")
	ResetUserPasswordCmd.Flags().StringP("password", "p", "", "新密码（至少 6 位）")
	ResetCodeCmd.Flags().StringP("username", "u", "", "要生成重置码的用户名")
}
