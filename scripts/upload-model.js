#!/usr/bin/env node

const OSS = require('ali-oss');
const fs = require('fs').promises;
const fsSync = require('fs');
const path = require('path');
const { glob } = require('glob');
require('dotenv').config();

class ModelUploader {
    constructor() {
        // 验证必需的环境变量
        this.validateEnv();
        
        // 初始化OSS客户端
        this.client = new OSS({
            region: process.env.OSS_REGION,
            accessKeyId: process.env.OSS_ACCESS_KEY_ID,
            accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET,
            bucket: process.env.OSS_BUCKET
        });
        
        // 配置参数
        this.bucketPath = process.env.OSS_BUCKET_PATH || 'model/';
        this.maxConcurrent = parseInt(process.env.UPLOAD_CONCURRENT) || 5;
        this.retryCount = parseInt(process.env.UPLOAD_RETRY) || 3;
        
        // 统计信息
        this.stats = {
            totalFiles: 0,
            uploaded: 0,
            skipped: 0,
            failed: 0,
            startTime: Date.now()
        };
        
        // 支持的文件扩展名
        this.supportedExtensions = ['.glb', '.gltf'];
        
        // 日志配置
        this.logDirectory = process.env.LOG_DIRECTORY || 'logs';
        this.initializeLogging();
    }
    
    /**
     * 初始化日志系统
     */
    initializeLogging() {
        // 确保日志目录存在
        if (!fsSync.existsSync(this.logDirectory)) {
            fsSync.mkdirSync(this.logDirectory, { recursive: true });
        }
        
        // 日志文件路径
        this.logFiles = {
            upload: path.join(this.logDirectory, 'upload.log'),
            uploadError: path.join(this.logDirectory, 'upload-error.log'),
            uploadSuccess: path.join(this.logDirectory, 'upload-success.log')
        };
    }
    
    /**
     * 写入日志
     * @param {string} level - 日志级别 (info, error, success)
     * @param {string} message - 日志消息
     * @param {Object} data - 额外数据
     */
    writeLog(level, message, data = {}) {
        const timestamp = new Date().toISOString();
        const logEntry = {
            timestamp,
            level,
            message,
            ...data
        };
        
        const logLine = JSON.stringify(logEntry) + '\n';
        
        // 写入通用日志
        fsSync.appendFileSync(this.logFiles.upload, logLine);
        
        // 根据级别写入专门的日志文件
        if (level === 'error' && this.logFiles.uploadError) {
            fsSync.appendFileSync(this.logFiles.uploadError, logLine);
        } else if (level === 'success' && this.logFiles.uploadSuccess) {
            fsSync.appendFileSync(this.logFiles.uploadSuccess, logLine);
        }
    }
    
    validateEnv() {
        const required = [
            'OSS_REGION',
            'OSS_ACCESS_KEY_ID', 
            'OSS_ACCESS_KEY_SECRET',
            'OSS_BUCKET'
        ];
        
        const missing = required.filter(key => !process.env[key]);
        if (missing.length > 0) {
            console.error('❌ 缺少必需的环境变量:', missing.join(', '));
            console.error('请在.env文件中配置以下变量:');
            console.error('OSS_REGION=oss-cn-hangzhou');
            console.error('OSS_ACCESS_KEY_ID=your_access_key_id'); 
            console.error('OSS_ACCESS_KEY_SECRET=your_access_key_secret');
            console.error('OSS_BUCKET=your_bucket_name');
            console.error('OSS_BUCKET_PATH=model/ (可选)');
            process.exit(1);
        }
    }
    
    /**
     * 生成OSS对象键名
     * @param {string} filePath - 本地文件路径
     * @param {boolean} preserveStructure - 是否保持目录结构
     * @returns {string} OSS对象键名
     */
    generateObjectKey(filePath, preserveStructure = false) {
        const basename = path.basename(filePath);
        const ext = path.extname(basename);
        const uid = path.basename(basename, ext);
        
        if (preserveStructure) {
            // 保持目录结构：使用相对路径
            const relativePath = path.relative(process.cwd(), filePath);
            return path.posix.join(this.bucketPath, relativePath);
        } else {
            // 扁平结构：直接将文件存储到 bucketPath 根目录下
            // 例如：model/1a/1ad234316a60422eb12edbe25353c051.glb -> model/1ad234316a60422eb12edbe25353c051.glb
            return path.posix.join(this.bucketPath, basename);
        }
    }
    
    /**
     * 检查文件是否已存在
     */
    async fileExists(objectKey) {
        try {
            await this.client.head(objectKey);
            return true;
        } catch (error) {
            if (error.code === 'NoSuchKey') {
                return false;
            }
            throw error;
        }
    }
    
    /**
     * 上传单个文件
     */
    async uploadFile(filePath, options = {}) {
        const { 
            overwrite = false, 
            preserveStructure = false,
            progress = null 
        } = options;
        
        try {
            const objectKey = this.generateObjectKey(filePath, preserveStructure);
            
            // 检查文件是否已存在
            if (!overwrite && await this.fileExists(objectKey)) {
                console.log(`⏭️  跳过已存在的文件: ${objectKey}`);
                this.stats.skipped++;
                return { success: true, skipped: true, objectKey };
            }
            
            // 获取文件信息
            const stats = await fs.stat(filePath);
            const fileSize = stats.size;
            
            console.log(`⬆️  上传: ${filePath} -> ${objectKey} (${this.formatBytes(fileSize)})`);
            
            // 上传选项
            const uploadOptions = {
                meta: {
                    'original-name': path.basename(filePath),
                    'file-size': fileSize.toString(),
                    'upload-time': new Date().toISOString()
                },
                headers: {
                    'Content-Type': 'model/gltf-binary',
                    'Cache-Control': 'max-age=31536000' // 1年缓存
                }
            };
            
            // 添加进度回调
            if (progress) {
                uploadOptions.progress = (p) => {
                    progress(p, filePath, objectKey);
                };
            }
            
            // 执行上传
            const result = await this.client.put(objectKey, filePath, uploadOptions);
            
            console.log(`✅ 上传成功: ${objectKey}`);
            this.stats.uploaded++;
            
            // 记录成功上传日志
            this.writeLog('success', '文件上传成功', {
                filePath,
                objectKey,
                url: result.url,
                fileSize,
                options: {
                    overwrite,
                    preserveStructure
                },
                bucketPath: this.bucketPath,
                uploadTime: Date.now() - this.stats.startTime
            });
            
            return { 
                success: true, 
                objectKey,
                url: result.url,
                size: fileSize 
            };
            
        } catch (error) {
            console.error(`❌ 上传失败: ${filePath}`);
            console.error(`   错误: ${error.message}`);
            this.stats.failed++;
            
            // 记录详细的失败日志
            this.writeLog('error', '文件上传失败', {
                filePath,
                objectKey: this.generateObjectKey(filePath, preserveStructure),
                error: {
                    message: error.message,
                    code: error.code || 'UNKNOWN',
                    stack: error.stack
                },
                fileSize: await this.getFileSize(filePath),
                options: {
                    overwrite,
                    preserveStructure
                },
                bucketPath: this.bucketPath,
                retryAttempt: options.retryAttempt || 1
            });
            
            return { 
                success: false, 
                error: error.message, 
                filePath 
            };
        }
    }
    
    /**
     * 批量上传文件
     */
    async uploadFiles(files, options = {}) {
        const { 
            overwrite = false, 
            preserveStructure = false 
        } = options;
        
        console.log(`🚀 开始批量上传 ${files.length} 个文件...\n`);
        
        const results = [];
        const semaphore = new Array(this.maxConcurrent).fill(Promise.resolve());
        
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            
            // 等待可用的并发槽
            const semIndex = i % this.maxConcurrent;
            await semaphore[semIndex];
            
            // 创建上传任务
            semaphore[semIndex] = this.uploadFileWithRetry(file, {
                overwrite,
                preserveStructure,
                progress: (p, filePath, objectKey) => {
                    process.stdout.write(`\r📊 [${i + 1}/${files.length}] ${path.basename(filePath)} - ${Math.round(p * 100)}%`);
                }
            }).then(result => {
                results.push(result);
                process.stdout.write('\n');
                return result;
            });
        }
        
        // 等待所有任务完成
        await Promise.all(semaphore);
        
        return results;
    }
    
    /**
     * 带重试的文件上传
     */
    async uploadFileWithRetry(filePath, options = {}) {
        let lastError;
        
        for (let attempt = 1; attempt <= this.retryCount; attempt++) {
            try {
                // 传递重试次数信息
                const optionsWithRetry = { ...options, retryAttempt: attempt };
                return await this.uploadFile(filePath, optionsWithRetry);
            } catch (error) {
                lastError = error;
                
                if (attempt < this.retryCount) {
                    const delay = Math.pow(2, attempt) * 1000; // 指数退避
                    console.log(`⚠️  上传失败，${delay/1000}秒后重试 (${attempt}/${this.retryCount}): ${filePath}`);
                    
                    // 记录重试日志
                    this.writeLog('info', '上传重试', {
                        filePath,
                        attempt,
                        totalRetries: this.retryCount,
                        error: error.message,
                        nextRetryDelay: delay
                    });
                    
                    await this.sleep(delay);
                }
            }
        }
        
        return { success: false, error: lastError.message, filePath };
    }
    
    /**
     * 扫描GLB文件
     */
    async scanFiles(pattern) {
        console.log(`🔍 扫描文件: ${pattern}`);
        
        let files = [];
        
        if (await this.isFile(pattern)) {
            // 单个文件
            if (this.isSupportedFile(pattern)) {
                files.push(path.resolve(pattern));
            } else {
                throw new Error(`不支持的文件类型: ${pattern}`);
            }
        } else {
            // 使用glob模式匹配文件
            const globPattern = pattern.includes('*') ? pattern : path.join(pattern, '**', '*.{glb,gltf}');
            const matches = await glob(globPattern, { 
                absolute: true,
                ignore: ['**/node_modules/**', '**/.git/**']
            });
            
            files = matches.filter(file => this.isSupportedFile(file));
        }
        
        this.stats.totalFiles = files.length;
        console.log(`📁 找到 ${files.length} 个GLB/GLTF文件\n`);
        
        return files;
    }
    
    /**
     * 检查是否为文件
     */
    async isFile(filepath) {
        try {
            const stats = await fs.stat(filepath);
            return stats.isFile();
        } catch {
            return false;
        }
    }
    
    /**
     * 检查是否为支持的文件
     */
    isSupportedFile(filePath) {
        const ext = path.extname(filePath).toLowerCase();
        return this.supportedExtensions.includes(ext);
    }
    
    /**
     * 获取文件大小（安全方法）
     */
    async getFileSize(filePath) {
        try {
            const stats = await fs.stat(filePath);
            return stats.size;
        } catch (error) {
            return 0;
        }
    }
    
    /**
     * 格式化字节大小
     */
    formatBytes(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }
    
    /**
     * 延时函数
     */
    sleep(ms) {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
    
    /**
     * 打印统计信息
     */
    printStats() {
        const duration = (Date.now() - this.stats.startTime) / 1000;
        const uploadRate = duration > 0 ? (this.stats.uploaded / duration).toFixed(2) : 0;
        
        console.log('\n📊 上传统计:');
        console.log(`⏱️  总耗时: ${duration.toFixed(2)} 秒`);
        console.log(`📁 扫描文件: ${this.stats.totalFiles}`);
        console.log(`✅ 上传成功: ${this.stats.uploaded}`);
        console.log(`⏭️  跳过文件: ${this.stats.skipped}`);
        console.log(`❌ 上传失败: ${this.stats.failed}`);
        console.log(`⚡ 上传速度: ${uploadRate} 文件/秒`);
        
        if (this.stats.failed > 0) {
            console.log('\n⚠️  存在上传失败的文件，请检查网络连接和OSS配置');
            console.log(`📄 详细错误日志: ${this.logFiles.uploadError}`);
        }
        
        console.log(`\n📋 日志文件:`);
        console.log(`   通用日志: ${this.logFiles.upload}`);
        console.log(`   成功日志: ${this.logFiles.uploadSuccess}`);
        console.log(`   错误日志: ${this.logFiles.uploadError}`);
    }
    
    /**
     * 测试OSS连接
     */
    async testConnection() {
        try {
            console.log('🔗 测试OSS连接...');
            await this.client.getBucketInfo();
            console.log('✅ OSS连接测试成功');
            return true;
        } catch (error) {
            console.error('❌ OSS连接测试失败:', error.message);
            return false;
        }
    }
}

/**
 * 主函数
 */
async function main() {
    const args = process.argv.slice(2);
    
    if (args.length === 0) {
        console.log(`
GLB模型文件上传工具

用法: node scripts/upload-model.js [options] <file_or_pattern>

参数:
  <file_or_pattern>     单个文件路径或glob模式 (如: model/**/*.glb)

选项:
  --overwrite          覆盖已存在的文件
  --preserve-structure 保持目录结构 (默认为扁平结构)
  --test              仅测试OSS连接，不执行上传

路径映射说明:
  默认扁平结构: model/1a/filename.glb -> model/filename.glb
  保持结构:     model/1a/filename.glb -> model/1a/filename.glb

示例:
  # 上传单个文件 (扁平存储)
  node scripts/upload-model.js model/1a/1ad234316a60422eb12edbe25353c051.glb
  # 存储为: model/1ad234316a60422eb12edbe25353c051.glb
  
  # 上传目录下的所有GLB文件 (扁平存储)
  node scripts/upload-model.js "model/**/*.glb"
  
  # 覆盖现有文件
  node scripts/upload-model.js --overwrite "model/**/*.glb"
  
  # 保持原始目录结构
  node scripts/upload-model.js --preserve-structure "model/**/*.glb"
  # 存储为: model/1a/1ad234316a60422eb12edbe25353c051.glb
  
  # 测试连接
  node scripts/upload-model.js --test

环境变量:
  OSS_REGION            OSS区域 (如: oss-cn-hangzhou)
  OSS_ACCESS_KEY_ID     访问密钥ID
  OSS_ACCESS_KEY_SECRET 访问密钥Secret  
  OSS_BUCKET           存储桶名称
  OSS_BUCKET_PATH      存储桶路径前缀 (默认: model/)
  UPLOAD_CONCURRENT    并发上传数 (默认: 5)
  UPLOAD_RETRY         重试次数 (默认: 3)
  LOG_DIRECTORY        日志目录 (默认: logs)

日志文件:
  logs/upload.log        通用上传日志 (包含所有操作)
  logs/upload-error.log  上传失败详细日志
  logs/upload-success.log 上传成功记录
`);
        process.exit(0);
    }
    
    // 解析命令行参数
    const options = {
        overwrite: args.includes('--overwrite'),
        preserveStructure: args.includes('--preserve-structure'),
        test: args.includes('--test')
    };
    
    const patterns = args.filter(arg => !arg.startsWith('--'));
    
    try {
        const uploader = new ModelUploader();
        
        // 测试连接
        if (!(await uploader.testConnection())) {
            process.exit(1);
        }
        
        if (options.test) {
            console.log('✅ 连接测试完成');
            return;
        }
        
        if (patterns.length === 0) {
            console.error('❌ 请指定要上传的文件或模式');
            process.exit(1);
        }
        
        // 记录上传任务开始
        uploader.writeLog('info', '上传任务开始', {
            patterns,
            options,
            environment: {
                nodeVersion: process.version,
                platform: process.platform,
                cwd: process.cwd()
            }
        });
        
        // 处理每个模式
        for (const pattern of patterns) {
            console.log(`\n处理模式: ${pattern}`);
            
            // 扫描文件
            const files = await uploader.scanFiles(pattern);
            
            if (files.length === 0) {
                console.log('⚠️  未找到匹配的文件');
                continue;
            }
            
            // 批量上传
            await uploader.uploadFiles(files, options);
        }
        
        // 记录上传任务完成
        uploader.writeLog('info', '上传任务完成', {
            stats: uploader.stats,
            duration: (Date.now() - uploader.stats.startTime) / 1000
        });
        
        // 打印统计信息
        uploader.printStats();
        
        // 根据结果设置退出码
        process.exit(uploader.stats.failed > 0 ? 1 : 0);
        
    } catch (error) {
        console.error('💥 执行出错:', error.message);
        console.error(error.stack);
        process.exit(1);
    }
}

// 处理未捕获的异常
process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的Promise拒绝:', reason);
    process.exit(1);
});

process.on('uncaughtException', (error) => {
    console.error('未捕获的异常:', error);
    process.exit(1);
});

// 执行主函数
if (require.main === module) {
    main();
}

module.exports = ModelUploader;