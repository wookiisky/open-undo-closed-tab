/**
 * Chrome Extension Icon Generation Script
 * Generate all required sizes based on icon128.png
 */

const sharp = require('sharp');
const fs = require('fs');
const path = require('path');

// Configuration
const SOURCE_ICON = path.join(__dirname, 'icons', 'icon128.png');
const OUTPUT_DIR = path.join(__dirname, 'icons');
const SIZES = [16, 32, 48, 128];

// Color codes
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function checkSourceIcon() {
  if (!fs.existsSync(SOURCE_ICON)) {
    log(`❌ Error: Source icon file not found ${SOURCE_ICON}`, 'red');
    log('Please ensure icons/icon128.png file exists', 'yellow');
    process.exit(1);
  }

  // Validate image dimensions
  try {
    const metadata = await sharp(SOURCE_ICON).metadata();
    if (metadata.width !== 128 || metadata.height !== 128) {
      log(`⚠️  Warning: Source icon size is ${metadata.width}x${metadata.height}, recommend using 128x128`, 'yellow');
    }
    log(`✓ Source icon: ${metadata.width}x${metadata.height}, format: ${metadata.format}`, 'cyan');
  } catch (error) {
    log(`❌ Error: Cannot read source icon: ${error.message}`, 'red');
    process.exit(1);
  }
}

async function generateIcon(size) {
  const outputPath = path.join(OUTPUT_DIR, `icon${size}.png`);
  
  try {
    await sharp(SOURCE_ICON)
      .resize(size, size, {
        kernel: sharp.kernel.lanczos3, // High quality scaling algorithm
        fit: 'contain', // Maintain aspect ratio, contain within specified dimensions
        background: { r: 0, g: 0, b: 0, alpha: 0 } // Transparent background
      })
      .png({
        compressionLevel: 9, // Maximum compression
        quality: 100 // Highest quality
      })
      .toFile(outputPath);

    const stats = fs.statSync(outputPath);
    const sizeKB = (stats.size / 1024).toFixed(2);
    log(`  ✓ icon${size}.png (${sizeKB} KB)`, 'green');
  } catch (error) {
    log(`  ✗ icon${size}.png generation failed: ${error.message}`, 'red');
    throw error;
  }
}

async function generateAllIcons() {
  log('\n🎨 Chrome Extension Icon Generator\n', 'blue');
  
  // Check source file
  await checkSourceIcon();
  
  // Ensure output directory exists
  if (!fs.existsSync(OUTPUT_DIR)) {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
    log(`✓ Created directory: ${OUTPUT_DIR}`, 'cyan');
  }
  
  log('\n📦 Starting icon generation...\n', 'cyan');
  
  // Generate all sizes
  for (const size of SIZES) {
    await generateIcon(size);
  }
  
  log('\n✨ All icons generated successfully!\n', 'green');
  log('Next steps:', 'blue');
  log('  1. Check all icon files in icons/ directory', 'cyan');
  log('  2. Reload extension at chrome://extensions/', 'cyan');
  log('  3. Verify icon display in different locations', 'cyan');
  log('');
}

// Check if sharp is installed
try {
  require.resolve('sharp');
} catch (error) {
  log('\n❌ Error: sharp module not installed\n', 'red');
  log('Please run the following command to install dependencies:', 'yellow');
  log('  npm install sharp\n', 'cyan');
  process.exit(1);
}

// Execute generation
generateAllIcons().catch(error => {
  log(`\n❌ Generation failed: ${error.message}`, 'red');
  process.exit(1);
});

