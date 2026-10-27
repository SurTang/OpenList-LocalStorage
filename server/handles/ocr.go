package handles

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"time"

	"github.com/OpenListTeam/OpenList/v4/internal/fs"
	"github.com/OpenListTeam/OpenList/v4/internal/model"
	http_range "github.com/OpenListTeam/OpenList/v4/pkg/http_range"
	"github.com/OpenListTeam/OpenList/v4/server/common"
	"github.com/gin-gonic/gin"
)

// 本文件的 OCR 完全在本机完成：
//   - Windows：调用系统自带的 Windows.Media.Ocr（WinRT）离线识别引擎；
//   - 其他平台：可通过环境变量 OPENLIST_OCR_CMD 指定本地命令（第一个参数为图片路径）。
//
// 不访问任何互联网接口。
const maxOcrImageSize = 20 << 20 // 20MB

const winOcrScript = `param([string]$ImagePath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation{{BT}}1' })[0]
function Await($WinRtTask, $ResultType) {
  $asTask = $asTaskGeneric.MakeGenericMethod($ResultType)
  $netTask = $asTask.Invoke($null, @($WinRtTask))
  $netTask.Wait(-1) | Out-Null
  return $netTask.Result
}
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.BitmapDecoder, Windows.Graphics.Imaging, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Media.Ocr, ContentType = WindowsRuntime]
$file = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync($ImagePath)) ([Windows.Storage.StorageFile])
$stream = Await ($file.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$decoder = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($stream)) ([Windows.Graphics.Imaging.BitmapDecoder])
$bitmap = Await ($decoder.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if ($null -eq $engine) {
  $lang = New-Object Windows.Globalization.Language 'zh-Hans-CN'
  $engine = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage($lang)
}
if ($null -eq $engine) { Write-Error 'no ocr language pack'; exit 3 }
$result = Await ($engine.RecognizeAsync($bitmap)) ([Windows.Media.Ocr.OcrResult])
$lines = @()
foreach ($line in $result.Lines) { $lines += $line.Text }
[Console]::Out.Write(($lines -join [Environment]::NewLine))
`

var (
	ocrScriptOnce sync.Once
	ocrScriptPath string
	ocrScriptErr  error
)

func ensureOcrScript() (string, error) {
	ocrScriptOnce.Do(func() {
		dir := filepath.Join(os.TempDir(), "openlist-ocr")
		if err := os.MkdirAll(dir, 0o755); err != nil {
			ocrScriptErr = err
			return
		}
		p := filepath.Join(dir, "win_ocr.ps1")
		if err := os.WriteFile(p, []byte(strings.ReplaceAll(winOcrScript, "{{BT}}", "`")), 0o644); err != nil {
			ocrScriptErr = err
			return
		}
		ocrScriptPath = p
	})
	return ocrScriptPath, ocrScriptErr
}

type ocrPathReq struct {
	Path string `json:"path"`
}

// OCR 图片文字识别（本地引擎）
func OCR(c *gin.Context) {
	var data []byte
	var ext string
	var err error

	if file, ferr := c.FormFile("file"); ferr == nil {
		if file.Size > maxOcrImageSize {
			common.ErrorStrResp(c, "图片过大（上限 20MB）", 400)
			return
		}
		f, oerr := file.Open()
		if oerr != nil {
			common.ErrorResp(c, oerr, 500)
			return
		}
		defer f.Close()
		data, err = io.ReadAll(io.LimitReader(f, maxOcrImageSize))
		if err != nil {
			common.ErrorResp(c, err, 500)
			return
		}
		ext = strings.ToLower(filepath.Ext(file.Filename))
	} else {
		var req ocrPathReq
		body, _ := io.ReadAll(io.LimitReader(c.Request.Body, 1<<20))
		if len(body) > 0 {
			if jerr := json.Unmarshal(body, &req); jerr != nil {
				common.ErrorStrResp(c, "请求格式不正确", 400)
				return
			}
		}
		if strings.TrimSpace(req.Path) == "" {
			common.ErrorStrResp(c, "缺少图片文件或文件路径", 400)
			return
		}
		data, ext, err = readStorageFile(c.Request.Context(), req.Path)
		if err != nil {
			common.ErrorResp(c, err, 400)
			return
		}
	}

	switch ext {
	case ".jpg", ".jpeg", ".png", ".bmp", ".gif", ".tif", ".tiff", ".webp":
	default:
		ext = ".png"
	}

	text, engine, err := runLocalOcr(data, ext)
	if err != nil {
		common.ErrorStrResp(c, err.Error(), 501)
		return
	}
	common.SuccessResp(c, gin.H{"text": text, "engine": engine})
}

func readStorageFile(ctx context.Context, path string) ([]byte, string, error) {
	link, obj, err := fs.Link(ctx, path, model.LinkArgs{})
	if err != nil {
		return nil, "", err
	}
	ext := strings.ToLower(filepath.Ext(obj.GetName()))
	var reader io.ReadCloser
	if link.RangeReader != nil {
		reader, err = link.RangeReader.RangeRead(ctx, http_range.Range{Start: 0, Length: maxOcrImageSize})
		if err != nil {
			return nil, "", err
		}
	} else if link.URL != "" {
		req, rerr := http.NewRequestWithContext(ctx, http.MethodGet, link.URL, nil)
		if rerr != nil {
			return nil, "", rerr
		}
		for k, v := range link.Header {
			req.Header[k] = v
		}
		resp, rerr := http.DefaultClient.Do(req)
		if rerr != nil {
			return nil, "", rerr
		}
		reader = resp.Body
	} else {
		return nil, "", fmt.Errorf("该存储无法直接读取文件内容")
	}
	defer reader.Close()
	data, err := io.ReadAll(io.LimitReader(reader, maxOcrImageSize))
	if err != nil {
		return nil, "", err
	}
	return data, ext, nil
}

// runLocalOcr 调用本机离线 OCR 引擎
func runLocalOcr(data []byte, ext string) (string, string, error) {
	tmp, err := os.CreateTemp("", "openlist-ocr-*"+ext)
	if err != nil {
		return "", "", err
	}
	tmpPath := tmp.Name()
	defer os.Remove(tmpPath)
	if _, err = tmp.Write(data); err != nil {
		tmp.Close()
		return "", "", err
	}
	tmp.Close()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()

	if custom := strings.TrimSpace(os.Getenv("OPENLIST_OCR_CMD")); custom != "" {
		fields := strings.Fields(custom)
		args := append(fields[1:], tmpPath)
		out, err := exec.CommandContext(ctx, fields[0], args...).Output()
		if err != nil {
			return "", "", fmt.Errorf("本地 OCR 命令执行失败：%v", err)
		}
		return strings.TrimSpace(string(out)), "local-command", nil
	}

	if runtime.GOOS != "windows" {
		return "", "", fmt.Errorf("当前系统未内置本地 OCR 引擎，可通过 OPENLIST_OCR_CMD 指定本地命令")
	}
	script, err := ensureOcrScript()
	if err != nil {
		return "", "", fmt.Errorf("准备本地 OCR 脚本失败：%v", err)
	}
	var stdout, stderr bytes.Buffer
	cmd := exec.CommandContext(ctx, "powershell.exe", "-NoProfile", "-NonInteractive",
		"-ExecutionPolicy", "Bypass", "-File", script, tmpPath)
	cmd.Stdout = &stdout
	cmd.Stderr = &stderr
	if err = cmd.Run(); err != nil {
		msg := strings.TrimSpace(stderr.String())
		if msg == "" {
			msg = err.Error()
		}
		return "", "", fmt.Errorf("本地 OCR 识别失败：%s", msg)
	}
	return strings.TrimSpace(stdout.String()), "windows-ocr", nil
}
