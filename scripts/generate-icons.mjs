import sharp from 'sharp'

const svgIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="96" fill="#1e293b"/>
  <text x="256" y="200" text-anchor="middle" font-size="120" font-family="system-ui, sans-serif" font-weight="bold" fill="#f8fafc">📊</text>
  <text x="256" y="320" text-anchor="middle" font-size="72" font-family="system-ui, sans-serif" font-weight="bold" fill="#f8fafc">Stat</text>
  <text x="256" y="400" text-anchor="middle" font-size="72" font-family="system-ui, sans-serif" font-weight="bold" fill="#3b82f6">Keeper</text>
</svg>`

const sizes = [192, 512]

for (const size of sizes) {
  await sharp(Buffer.from(svgIcon))
    .resize(size, size)
    .png()
    .toFile(`public/pwa-${size}x${size}.png`)
  console.log(`Generated pwa-${size}x${size}.png`)
}

const appleSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 180 180">
  <rect width="180" height="180" rx="32" fill="#1e293b"/>
  <text x="90" y="70" text-anchor="middle" font-size="42" font-family="system-ui, sans-serif" font-weight="bold" fill="#f8fafc">📊</text>
  <text x="90" y="115" text-anchor="middle" font-size="26" font-family="system-ui, sans-serif" font-weight="bold" fill="#f8fafc">Stat</text>
  <text x="90" y="145" text-anchor="middle" font-size="26" font-family="system-ui, sans-serif" font-weight="bold" fill="#3b82f6">Keeper</text>
</svg>`

await sharp(Buffer.from(appleSvg))
  .resize(180, 180)
  .png()
  .toFile('public/apple-touch-icon.png')
console.log('Generated apple-touch-icon.png')

console.log('Done!')
