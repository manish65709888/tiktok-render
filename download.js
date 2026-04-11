#!/usr/bin/env node

/**
 * Download Gift Assets Script
 * Downloads all gift animation videos and sounds from the server to local image/ directory
 */

const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

// Gift library from mode1.html
const giftLibrary = {
 
};

// Add the missing image files to additionalAssets instead, or update giftLibrary with available assets

// Additional assets
const additionalAssets = [
    'image/leonandlionicon.png',
    '/image/pegasusicon.png',
    'image/thunderfalconicon.png'
];

// Configuration
const config = {
    baseUrl: process.argv[2] || 'https://twowwwvvwwwwwwwwwwwwwwwwwwwwvvwwwwwwwwww.onrender.com',  // Server URL from command line or default
    outputDir: path.join(__dirname, 'image'),
    timeout: 30000,  // 30 seconds timeout per file
};

// Create output directory if it doesn't exist
if (!fs.existsSync(config.outputDir)) {
    fs.mkdirSync(config.outputDir, { recursive: true });
    console.log(`✓ Created directory: ${config.outputDir}`);
}

// Download a single file
function downloadFile(fileUrl, outputPath) {
    return new Promise((resolve, reject) => {
        const fullUrl = fileUrl.startsWith('http') ? fileUrl : `${config.baseUrl}/${fileUrl}`;
        const parsedUrl = url.parse(fullUrl);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        console.log(`Downloading: ${fileUrl}`);
        console.log(`       From: ${fullUrl}`);
        console.log(`         To: ${outputPath}`);

        // Check if file already exists
        if (fs.existsSync(outputPath)) {
            console.log(`⚠ File already exists, skipping: ${path.basename(outputPath)}\n`);
            resolve({ skipped: true, path: outputPath });
            return;
        }

        const file = fs.createWriteStream(outputPath);
        let downloadedBytes = 0;

        const request = protocol.get(fullUrl, (response) => {
            // Handle redirects
            if (response.statusCode === 301 || response.statusCode === 302) {
                file.close();
                fs.unlinkSync(outputPath);
                const redirectUrl = response.headers.location;
                console.log(`↪ Redirecting to: ${redirectUrl}`);
                downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
                return;
            }

            if (response.statusCode !== 200) {
                file.close();
                fs.unlinkSync(outputPath);
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const totalBytes = parseInt(response.headers['content-length'] || '0', 10);
            
            response.on('data', (chunk) => {
                downloadedBytes += chunk.length;
                if (totalBytes > 0) {
                    const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
                    process.stdout.write(`\r  Progress: ${percent}% (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB / ${(totalBytes / 1024 / 1024).toFixed(2)} MB)`);
                }
            });

            response.pipe(file);

            file.on('finish', () => {
                file.close();
                if (totalBytes > 0) {
                    process.stdout.write('\n');
                }
                console.log(`✓ Downloaded: ${path.basename(outputPath)} (${(downloadedBytes / 1024 / 1024).toFixed(2)} MB)\n`);
                resolve({ success: true, path: outputPath, size: downloadedBytes });
            });
        });

        request.on('error', (err) => {
            file.close();
            fs.unlinkSync(outputPath);
            reject(err);
        });

        request.setTimeout(config.timeout, () => {
            request.destroy();
            file.close();
            fs.unlinkSync(outputPath);
            reject(new Error('Download timeout'));
        });
    });
}

// Main download function
async function downloadAllAssets() {
    console.log('='.repeat(60));
    console.log('Gift Assets Downloader');
    console.log('='.repeat(60));
    console.log(`Base URL: ${config.baseUrl}`);
    console.log(`Output Directory: ${config.outputDir}`);
    console.log('='.repeat(60));
    console.log();

    const downloads = [];
    const results = {
        success: [],
        failed: [],
        skipped: []
    };

    // Collect all files to download
    for (const [giftId, gift] of Object.entries(giftLibrary)) {
        // Add video sources
        if (gift.sources) {
            for (const source of gift.sources) {
                downloads.push({ url: source, gift: giftId, type: 'video' });
            }
        }
        
        // Add sound (if different from video)
        if (gift.sound && !gift.sources?.includes(gift.sound)) {
            downloads.push({ url: gift.sound, gift: giftId, type: 'audio' });
        }
    }

    // Add additional assets
    for (const asset of additionalAssets) {
        downloads.push({ url: asset, gift: 'additional', type: 'asset' });
    }

    console.log(`Total files to download: ${downloads.length}\n`);

    // Download each file
    for (let i = 0; i < downloads.length; i++) {
        const { url: fileUrl, gift, type } = downloads[i];
        const fileName = path.basename(fileUrl);
        const outputPath = path.join(config.outputDir, fileName);

        console.log(`[${i + 1}/${downloads.length}] ${gift} (${type})`);
        
        try {
            const result = await downloadFile(fileUrl, outputPath);
            if (result.skipped) {
                results.skipped.push(fileName);
            } else {
                results.success.push(fileName);
            }
        } catch (error) {
            console.error(`✗ Failed: ${fileName}`);
            console.error(`  Error: ${error.message}\n`);
            results.failed.push({ file: fileName, error: error.message });
        }
    }

    // Print summary
    console.log('='.repeat(60));
    console.log('Download Summary');
    console.log('='.repeat(60));
    console.log(`✓ Successfully downloaded: ${results.success.length}`);
    console.log(`⚠ Skipped (already exist): ${results.skipped.length}`);
    console.log(`✗ Failed: ${results.failed.length}`);
    
    if (results.failed.length > 0) {
        console.log('\nFailed downloads:');
        results.failed.forEach(({ file, error }) => {
            console.log(`  - ${file}: ${error}`);
        });
    }
    
    console.log('='.repeat(60));
    
    // Create a manifest file
    const manifest = {
        downloadDate: new Date().toISOString(),
        baseUrl: config.baseUrl,
        totalFiles: downloads.length,
        successful: results.success.length,
        skipped: results.skipped.length,
        failed: results.failed.length,
        files: results.success.concat(results.skipped)
    };
    
    const manifestPath = path.join(config.outputDir, 'download_manifest.json');
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    console.log(`\n✓ Manifest saved to: ${manifestPath}`);
}

// Run the downloader
console.log('\nStarting download...\n');
downloadAllAssets().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});