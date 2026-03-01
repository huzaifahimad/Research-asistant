# ScholarAI Server — Zero-Install PowerShell HTTP Server
# Just run: .\start.ps1
# Opens http://localhost:3000 in your browser

param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

# ── Read API key from .env ──
$envFile = Join-Path $PSScriptRoot ".env"
$apiKey = ""
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^ANTHROPIC_API_KEY=(.+)$") {
            $apiKey = $Matches[1].Trim()
        }
    }
}
if (-not $apiKey -or $apiKey -eq "YOUR_API_KEY_HERE") {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Yellow
    Write-Host "  SETUP REQUIRED: Edit .env file and set your" -ForegroundColor Yellow
    Write-Host "  ANTHROPIC_API_KEY before starting the server" -ForegroundColor Yellow
    Write-Host "  ============================================" -ForegroundColor Yellow
    Write-Host ""
    $apiKey = Read-Host "Or paste your Anthropic API key now"
    if (-not $apiKey) { exit 1 }
}

$publicDir = Join-Path $PSScriptRoot "public"
$dbFile = Join-Path $PSScriptRoot "scholarai_data.json"

# ── Simple JSON DB ──
$db = @{ users = @{}; stats = @{} }
if (Test-Path $dbFile) {
    $db = Get-Content $dbFile -Raw | ConvertFrom-Json -AsHashtable
    if (-not $db.users) { $db.users = @{} }
    if (-not $db.stats) { $db.stats = @{} }
}
function Save-Db { $db | ConvertTo-Json -Depth 10 | Set-Content $dbFile }

# ── MIME types ──
$mimeTypes = @{
    ".html" = "text/html"
    ".css"  = "text/css"
    ".js"   = "application/javascript"
    ".json" = "application/json"
    ".png"  = "image/png"
    ".jpg"  = "image/jpeg"
    ".svg"  = "image/svg+xml"
    ".ico"  = "image/x-icon"
}

# ── Start HTTP Listener ──
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Prefixes.Add("http://127.0.0.1:$Port/")
$listener.Start()

Write-Host ""
Write-Host "  +======================================+" -ForegroundColor Cyan
Write-Host "  |   ScholarAI Server Running            |" -ForegroundColor Cyan
Write-Host "  |   http://localhost:$Port               |" -ForegroundColor Cyan
Write-Host "  |   Press Ctrl+C to stop               |" -ForegroundColor Cyan
Write-Host "  +======================================+" -ForegroundColor Cyan
Write-Host ""

# Open browser
Start-Process "http://localhost:$Port"

function Send-Response($context, $statusCode, $contentType, $body) {
    $context.Response.StatusCode = $statusCode
    $context.Response.ContentType = $contentType
    $context.Response.Headers.Add("Access-Control-Allow-Origin", "*")
    $context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization, x-api-key, anthropic-version")
    $context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
    if ($body -is [byte[]]) {
        $context.Response.OutputStream.Write($body, 0, $body.Length)
    } else {
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
    }
    $context.Response.Close()
}

function Call-Claude($messagesJson, $system, $maxTokens) {
    $body = @{
        model = "claude-sonnet-4-6"
        max_tokens = $maxTokens
        messages = $messagesJson
    }
    if ($system) { $body.system = $system }
    $jsonBody = $body | ConvertTo-Json -Depth 10

    $headers = @{
        "Content-Type" = "application/json"
        "x-api-key" = $apiKey
        "anthropic-version" = "2023-06-01"
    }

    $response = Invoke-RestMethod -Uri "https://api.anthropic.com/v1/messages" -Method POST -Headers $headers -Body $jsonBody
    return $response.content[0].text
}

# ── Main Loop ──
try {
    while ($listener.IsListening) {
        $context = $listener.GetContext()
        $request = $context.Request
        $path = $request.Url.AbsolutePath
        $method = $request.HttpMethod

        Write-Host "$(Get-Date -Format 'HH:mm:ss') $method $path" -ForegroundColor DarkGray

        # CORS preflight
        if ($method -eq "OPTIONS") {
            Send-Response $context 200 "text/plain" ""
            continue
        }

        try {
            # ── API: Proxy to Claude ──
            if ($path -eq "/api/ai/proxy" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $reqData = $bodyText | ConvertFrom-Json

                $result = Call-Claude $reqData.messages $reqData.system $reqData.maxTokens
                $resp = @{ reply = $result } | ConvertTo-Json -Depth 5
                Send-Response $context 200 "application/json" $resp
                continue
            }

            # ── API: Save/Load Stats ──
            if ($path -eq "/api/stats" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $stats = $bodyText | ConvertFrom-Json -AsHashtable
                $db.stats = $stats
                Save-Db
                Send-Response $context 200 "application/json" '{"ok":true}'
                continue
            }

            if ($path -eq "/api/stats" -and $method -eq "GET") {
                $resp = $db.stats | ConvertTo-Json -Depth 5
                Send-Response $context 200 "application/json" $resp
                continue
            }

            # ── Static Files ──
            if ($path -eq "/" -or $path -eq "") { $path = "/index.html" }
            $filePath = Join-Path $publicDir ($path.TrimStart('/').Replace('/', '\'))

            if (Test-Path $filePath -PathType Leaf) {
                $ext = [System.IO.Path]::GetExtension($filePath)
                $mime = if ($mimeTypes.ContainsKey($ext)) { $mimeTypes[$ext] } else { "application/octet-stream" }
                $fileBytes = [System.IO.File]::ReadAllBytes($filePath)
                Send-Response $context 200 $mime $fileBytes
            } else {
                # SPA fallback
                $indexPath = Join-Path $publicDir "index.html"
                if (Test-Path $indexPath) {
                    $fileBytes = [System.IO.File]::ReadAllBytes($indexPath)
                    Send-Response $context 200 "text/html" $fileBytes
                } else {
                    Send-Response $context 404 "text/plain" "Not Found"
                }
            }
        } catch {
            Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
            $errResp = @{ error = $_.Exception.Message } | ConvertTo-Json
            Send-Response $context 500 "application/json" $errResp
        }
    }
} finally {
    $listener.Stop()
    Write-Host "`nServer stopped." -ForegroundColor Yellow
}
