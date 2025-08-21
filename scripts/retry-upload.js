#!/usr/bin/env node

const OSS = require('ali-oss');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

class UploadRetryManager {
    constructor() {
        this.validateEnv();
        
        // 初始化OSS客户端，优化超时设置
        this.client = new OSS({
            region: process.env.OSS_REGION,
            accessKeyId: process.env.OSS_ACCESS_KEY_ID,
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
            bucket: process.env.OSS_BUCKET,
            // 增加超时时间
            timeout: 300000, // 5分钟连接超时
            // 针对大文件优化分片大小
            partSize: 1024 * 1024, // 1MB 分片（默认是1MB，对于网络不稳定的情况可以减小）
        });
        
        // 配置参数
        this.bucketPath = process.env.OSS_BUCKET_PATH || 'model/';
        this.maxConcurrent = Math.min(parseInt(process.env.UPLOAD_CONCURRENT) || 2, 2); // 降低并发数
        this.retryCount = parseInt(process.env.UPLOAD_RETRY) || 5;
        this.retryDelay = parseInt(process.env.RETRY_DELAY) || 5000; // 5秒延迟
        
        // 统计信息
        this.stats = {
            totalFiles: 0,
            successCount: 0,
            failedCount: 0,
            skippedCount: 0,
            startTime: new Date(),
            processedSize: 0
        };
        
        // 日志配置
        this.logDir = './logs';
        this.ensureLogDir();
        
        // 失败的文件列表
        this.failedUploads = [];
    }
    
    validateEnv() {
        const required = ['OSS_REGION', 'OSS_ACCESS_KEY_ID', 'OSS_ACCESS_KEY_SECRET', 'OSS_BUCKET'];
        const missing = required.filter(key => !process.env[key]);
        
        if (missing.length > 0) {
            console.error('❌ 缺少必需的环境变量:', missing.join(', '));
            console.error('请检查 .env 文件配置');
            process.exit(1);
        }
    }
    
    ensureLogDir() {
        if (!fsSync.existsSync(this.logDir)) {
            fsSync.mkdirSync(this.logDir, { recursive: true });
        }
    }
    
    async parseErrorLog(logFilePath) {
        console.log('📖 解析错误日志文件:', logFilePath);
        
        const fileStream = fsSync.createReadStream(logFilePath);
        const rl = readline.createInterface({
            input: fileStream,
            crlfDelay: Infinity
        });
        
        const failedFiles = [];
        const errorStats = {
            connectionTimeout: 0,
            responseTimeout: 0,
            other: 0
        };
        
        for await (const line of rl) {
            try {
                const logEntry = JSON.parse(line);
                if (logEntry.level === 'error' && logEntry.filePath) {
                    failedFiles.push({
                        filePath: logEntry.filePath,
                        objectKey: logEntry.objectKey,
                        fileSize: logEntry.fileSize,
                        error: logEntry.error,
                        retryAttempt: logEntry.retryAttempt || 0
                    });
                    
                    // 统计错误类型
                    if (logEntry.error.code === 'ConnectionTimeoutError') {
                        errorStats.connectionTimeout++;
                    } else if (logEntry.error.message.includes('Response timeout')) {
                        errorStats.responseTimeout++;
                    } else {
                        errorStats.other++;
                    }
                }
            } catch (e) {
                // 忽略解析错误的行
            }
        }
        
        console.log('📊 错误统计:');
        console.log(`  连接超时: ${errorStats.connectionTimeout}`);
        console.log(`  响应超时: ${errorStats.responseTimeout}`);
        console.log(`  其他错误: ${errorStats.other}`);
        console.log(`  总计失败: ${failedFiles.length}`);
        
        return failedFiles;
    }
    
    async fileExists(objectKey) {
        try {
            await this.client.head(objectKey);
            return true;
        } catch (error) {
            if (error.code === 'NoSuchKey' || error.status === 404) {
                return false;
            }
            // 对于其他错误（如超时），抛出异常
            throw error;
        }
    }
    
    getOptimizedPartSize(fileSize) {
        // 根据文件大小动态调整分片大小
        if (fileSize < 10 * 1024 * 1024) { // < 10MB
            return 512 * 1024; // 512KB
        } else if (fileSize < 100 * 1024 * 1024) { // < 100MB
            return 1024 * 1024; // 1MB
        } else {
            return 2 * 1024 * 1024; // 2MB for large files
        }
    }
    
    async uploadFileWithRetry(failedFile, attempt = 1) {
        const { filePath, objectKey, fileSize } = failedFile;
        
        try {
            // 检查本地文件是否存在
            if (!fsSync.existsSync(filePath)) {
                throw new Error(`本地文件不存在: ${filePath}`);
            }
            
            // 检查远程文件是否已存在
            const exists = await this.fileExists(objectKey);
            if (exists) {
                console.log(`⏭️  文件已存在，跳过: ${path.basename(filePath)}`);
                this.stats.skippedCount++;
                return { success: true, skipped: true };
            }
            
            // 根据文件大小选择上传方法
            const partSize = this.getOptimizedPartSize(fileSize);
            
            console.log(`📤 上传文件 (尝试 ${attempt}/${this.retryCount}): ${path.basename(filePath)} (${this.formatFileSize(fileSize)})`);
            
            let result;
            if (fileSize > 100 * 1024 * 1024) { // > 100MB 使用分片上传
                result = await this.client.multipartUpload(objectKey, filePath, {
                    partSize: partSize,
                    timeout: 600000, // 10分钟超时
                    progress: (p, cpt, res) => {
                        process.stdout.write(`\r  进度: ${Math.round(p * 100)}%`);
                    }
                });
                console.log(); // 换行
            } else {
                // 小文件直接上传
                const stream = fsSync.createReadStream(filePath);
                result = await this.client.putStream(objectKey, stream, {
                    timeout: 300000 // 5分钟超时
                });
            }
            
            console.log(`✅ 上传成功: ${path.basename(filePath)}`);
            this.stats.successCount++;
            this.stats.processedSize += fileSize;
            
            // 记录成功日志
            await this.logSuccess({
                filePath,
                objectKey,
                fileSize,
                url: result.url,
                attempt
            });
            
            return { success: true };
            
        } catch (error) {
            console.log(`❌ 上传失败 (尝试 ${attempt}/${this.retryCount}): ${path.basename(filePath)}`);
            console.log(`   错误: ${error.message}`);
            
            // 记录失败日志
            await this.logError({
                filePath,
                objectKey,
                fileSize,
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN',
                    stack: error.stack
                },
                retryAttempt: attempt
            });
            
            if (attempt < this.retryCount) {
                // 计算延迟时间（指数退避）
                const delay = this.retryDelay * Math.pow(2, attempt - 1);
                console.log(`⏳ ${delay}ms 后重试...`);
                
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.uploadFileWithRetry(failedFile, attempt + 1);
            } else {
                console.log(`💀 重试次数已用完: ${path.basename(filePath)}`);
                this.stats.failedCount++;
                this.failedUploads.push({
                    ...failedFile,
                    finalError: error.message,
                    totalAttempts: attempt
                });
                return { success: false };
            }
        }
    }
    
    async processFiles(failedFiles) {
        console.log(`\n🚀 开始重试上传 ${failedFiles.length} 个失败的文件...\n`);
        this.stats.totalFiles = failedFiles.length;
        
        // 限制并发数
        const semaphore = new Array(this.maxConcurrent).fill(null);
        let index = 0;
        
        const processNext = async () => {
            if (index >= failedFiles.length) return;
            
            const currentIndex = index++;
            const failedFile = failedFiles[currentIndex];
            
            console.log(`\n[${currentIndex + 1}/${failedFiles.length}] 处理文件:`);
            
            await this.uploadFileWithRetry(failedFile);
            
            // 显示进度
            const progress = ((currentIndex + 1) / failedFiles.length * 100).toFixed(1);
            console.log(`📊 总进度: ${progress}% (${currentIndex + 1}/${failedFiles.length})`);
            
            // 继续处理下一个文件
            return processNext();
        };
        
        // 启动并发处理
        await Promise.all(semaphore.map(() => processNext()));
    }
    
    async logSuccess(data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'info',
            message: '文件重试上传成功',
            ...data
        };
        
        const logFile = path.join(this.logDir, 'retry-upload-success.log');
        await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    async logError(data) {
        const logEntry = {
            timestamp: new Date().toISOString(),
            level: 'error',
            message: '文件重试上传失败',
            ...data
        };
        
        const logFile = path.join(this.logDir, 'retry-upload-error.log');
        await fs.appendFile(logFile, JSON.stringify(logEntry) + '\n');
    }
    
    formatFileSize(bytes) {
        const sizes = ['B', 'KB', 'MB', 'GB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
    }
    
    formatDuration(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
        } else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        } else {
            return `${seconds}s`;
        }
    }
    
    async generateReport() {
        const endTime = new Date();
        const duration = endTime - this.stats.startTime;
        
        console.log('\n' + '='.repeat(60));
        console.log('📋 重试上传报告');
        console.log('='.repeat(60));
        console.log(`开始时间: ${this.stats.startTime.toLocaleString()}`);
        console.log(`结束时间: ${endTime.toLocaleString()}`);
        console.log(`总耗时: ${this.formatDuration(duration)}`);
        console.log(`总文件数: ${this.stats.totalFiles}`);
        console.log(`成功: ${this.stats.successCount}`);
        console.log(`跳过: ${this.stats.skippedCount}`);
        console.log(`失败: ${this.stats.failedCount}`);
        console.log(`处理数据: ${this.formatFileSize(this.stats.processedSize)}`);
        
        if (this.stats.successCount > 0) {
            const avgSpeed = this.stats.processedSize / (duration / 1000);
            console.log(`平均速度: ${this.formatFileSize(avgSpeed)}/s`);
        }
        
        console.log('='.repeat(60));
        
        // 保存详细报告
        const report = {
            summary: this.stats,
            duration: duration,
            endTime: endTime.toISOString(),
            failedFiles: this.failedUploads
        };
        
        const reportFile = path.join(this.logDir, `retry-upload-report-${Date.now()}.json`);
        await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
        console.log(`📄 详细报告已保存: ${reportFile}`);
        
        if (this.failedUploads.length > 0) {
            console.log('\n❌ 仍然失败的文件:');
            this.failedUploads.forEach((file, index) => {
                console.log(`  ${index + 1}. ${path.basename(file.filePath)} - ${file.finalError}`);
            });
        }
    }
}

async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log('用法: node retry-upload.js <error-log-file>');
        console.log('示例: node retry-upload.js logs/upload-error.log');
        process.exit(1);
    }
    
    const errorLogFile = args[0];
    
    if (!fsSync.existsSync(errorLogFile)) {
        console.error(`❌ 错误日志文件不存在: ${errorLogFile}`);
        process.exit(1);
    }
    
    const retryManager = new UploadRetryManager();
    
    try {
        // 解析错误日志
        const failedFiles = await retryManager.parseErrorLog(errorLogFile);
        
        if (failedFiles.length === 0) {
            console.log('✅ 没有找到失败的文件，无需重试');
            return;
        }
        
        // 开始重试上传
        await retryManager.processFiles(failedFiles);
        
        // 生成报告
        await retryManager.generateReport();
        
    } catch (error) {
        console.error('❌ 重试上传过程中发生错误:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 处理程序退出
process.on('SIGINT', async () => {
    console.log('\n\n⚠️  收到中断信号，正在保存进度...');
    process.exit(0);
});

process.on('uncaughtException', (error) => {
    console.error('❌ 未捕获的异常:', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('❌ 未处理的 Promise 拒绝:', reason);
    process.exit(1);
});

if (require.main === module) {
    main();
}

module.exports = UploadRetryManager;