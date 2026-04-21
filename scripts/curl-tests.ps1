param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$Email = "test@example.com",
  [string]$SigningSecret = ""
)

Write-Host "Testing subscription submit endpoint..." -ForegroundColor Cyan
curl.exe -i -X POST "$BaseUrl/api/subscribe" `
  -H "Content-Type: application/json" `
  -d "{\"email\":\"$Email\"}"

Write-Host "" 
Write-Host "Testing webhook receive endpoint..." -ForegroundColor Cyan

$body = "{\"event\":\"contact.created\",\"contact\":{\"email\":\"$Email\"}}"

if ([string]::IsNullOrWhiteSpace($SigningSecret)) {
  Write-Host "No signing secret provided. Sending unsigned webhook request." -ForegroundColor Yellow
  curl.exe -i -X POST "$BaseUrl/api/webhooks/sendpromotion" `
    -H "Content-Type: application/json" `
    -d "$body"
} else {
  Write-Host "Signing secret provided. Sending signed webhook request." -ForegroundColor Green

  $hmac = New-Object System.Security.Cryptography.HMACSHA256
  $hmac.Key = [Text.Encoding]::UTF8.GetBytes($SigningSecret)
  $signatureHex = ($hmac.ComputeHash([Text.Encoding]::UTF8.GetBytes($body)) | ForEach-Object ToString x2) -join ""

  curl.exe -i -X POST "$BaseUrl/api/webhooks/sendpromotion" `
    -H "Content-Type: application/json" `
    -H "X-SendPromotion-Signature: sha256=$signatureHex" `
    -d "$body"
}
