# ScholarAI Server — Zero-Install PowerShell HTTP Server
# Just run: .\start.ps1
# Opens http://localhost:3000 in your browser

param(
    [int]$Port = 3000
)

$ErrorActionPreference = "Stop"

# ── Read API key from .env ──
$envFile = Join-Path $PSScriptRoot ".env"
$script:apiKey = ""
if (Test-Path $envFile) {
    Get-Content $envFile | ForEach-Object {
        if ($_ -match "^GEMINI_API_KEY=(.+)$") {
            $script:apiKey = $Matches[1].Trim()
        }
    }
}
if (-not $script:apiKey -or $script:apiKey -eq "YOUR_API_KEY_HERE") {
    Write-Host ""
    Write-Host "  ============================================" -ForegroundColor Yellow
    Write-Host "  SETUP REQUIRED: Edit .env file and set your" -ForegroundColor Yellow
    Write-Host "  GEMINI_API_KEY before starting the server" -ForegroundColor Yellow
    Write-Host "  ============================================" -ForegroundColor Yellow
    Write-Host ""
    $script:apiKey = Read-Host "Or paste your Gemini API key now"
    if (-not $script:apiKey) { exit 1 }
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
    $context.Response.Headers.Add("Access-Control-Allow-Headers", "Content-Type, Authorization")
    $context.Response.Headers.Add("Access-Control-Allow-Methods", "GET, POST, OPTIONS, DELETE")
    if ($body -is [byte[]]) {
        $context.Response.OutputStream.Write($body, 0, $body.Length)
    }
    else {
        $buffer = [System.Text.Encoding]::UTF8.GetBytes($body)
        $context.Response.OutputStream.Write($buffer, 0, $buffer.Length)
    }
    $context.Response.Close()
}

function Invoke-GeminiGeneration($messages, $system, $maxTokens) {
    $contents = @()
    foreach ($msg in $messages) {
        $role = if ($msg.role -eq "assistant") { "model" } else { "user" }
        $contents += @{
            role  = $role
            parts = @(@{ text = $msg.content })
        }
    }

    $body = @{
        contents         = $contents
        generationConfig = @{
            maxOutputTokens = if ($maxTokens) { $maxTokens } else { 2048 }
        }
    }
    if ($system) { $body.systemInstruction = @{ parts = @(@{ text = $system }) } }

    $jsonBody = $body | ConvertTo-Json -Depth 10
    $uri = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$script:apiKey"

    try {
        $response = Invoke-RestMethod -Uri $uri -Method POST -ContentType "application/json" -Body $jsonBody
        return $response.candidates[0].content.parts[0].text
    }
    catch {
        $errObj = $_.Exception.Message
        if ($_.Exception.InnerException -and $_.Exception.InnerException.Response) {
            $reader = New-Object System.IO.StreamReader($_.Exception.InnerException.Response.GetResponseStream())
            $errBody = $reader.ReadToEnd()
            $reader.Close()
            $errData = $errBody | ConvertFrom-Json
            if ($errData.error) {
                $errObj = $errData.error.message
            }
        }
        throw $errObj
    }
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
            # ── API: Proxy to Gemini ──
            if ($path -eq "/api/ai/proxy" -and $method -eq "POST") {
                $reader = New-Object System.IO.StreamReader($request.InputStream)
                $bodyText = $reader.ReadToEnd()
                $reader.Close()
                $reqData = $bodyText | ConvertFrom-Json

                $result = Invoke-GeminiGeneration $reqData.messages $reqData.system $reqData.maxTokens
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
            }
            else {
                # SPA fallback
                $indexPath = Join-Path $publicDir "index.html"
                if (Test-Path $indexPath) {
                    $fileBytes = [System.IO.File]::ReadAllBytes($indexPath)
                    Send-Response $context 200 "text/html" $fileBytes
                }
                else {
                    Send-Response $context 404 "text/plain" "Not Found"
                }
            }
        }
        catch {
            Write-Host "  ERROR: $($_.Exception.Message)" -ForegroundColor Red
            $errResp = @{ error = $_.Exception.Message } | ConvertTo-Json
            Send-Response $context 500 "application/json" $errResp
        }
    }
}
finally {
    $listener.Stop()
    Write-Host "`nServer stopped." -ForegroundColor Yellow
}
