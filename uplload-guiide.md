# GLB模型文件上传指南

本指南介绍如何使用 `scripts/upload-model.js` 脚本将3D模型文件上传到阿里云OSS私有云存储。

## 前置条件

1. **安装依赖**
```bash
npm install
```

2. **配置阿里云OSS**
   - 在阿里云控制台创建OSS存储桶
   - 创建访问密钥（AccessKey ID 和 AccessKey Secret）
   - 确保存储桶有适当的权限设置

3. **环境变量配置**

复制 `.env.example` 到 `.env` 并配置以下变量：

```bash
# 阿里云OSS配置
OSS_REGION=oss-cn-hangzhou              # OSS区域
OSS_ACCESS_KEY_ID=your_access_key_id    # 访问密钥ID
OSS_ACCESS_KEY_SECRET=your_secret       # 访问密钥Secret  
OSS_BUCKET=your-bucket-name             # 存储桶名称
OSS_BUCKET_PATH=model/                  # 存储桶内路径前缀
UPLOAD_CONCURRENT=5                     # 并发上传数
UPLOAD_RETRY=3                         # 重试次数
```

## 使用方法

### 基础命令

```bash
# 使用npm script
npm run upload [options] <file_or_pattern>

# 或直接运行脚本
node scripts/upload-model.js [options] <file_or_pattern>
```

### 1. 上传单个GLB文件

```bash
# 上传单个文件
npm run upload model/1a/1ad234316a60422eb12edbe25353c051.glb

# 上传单个文件并覆盖已存在的文件
npm run upload -- --overwrite model/1a/1ad234316a60422eb12edbe25353c051.glb
```

### 2. 按目录批量上传

```bash
# 上传model目录下所有GLB文件 
npm run upload "model/**/*.glb"

# 上传特定子目录的文件
npm run upload "model/1a/*.glb"

# 上传多种格式的文件
npm run upload "model/**/*.{glb,gltf}"
```

### 3. 高级选项

```bash
# 覆盖已存在的文件
npm run upload -- --overwrite "model/**/*.glb"

# 保持原始目录结构（默认为扁平结构）
npm run upload -- --preserve-structure "model/**/*.glb"

# 仅测试OSS连接，不执行上传
npm run upload -- --test

# 组合多个选项
npm run upload -- --overwrite --preserve-structure "model/**/*.glb"
```

## 文件组织结构

### 默认结构（扁平结构）

脚本默认使用扁平结构存储文件，根据文件UID的前两位字符创建目录：

```
OSS存储桶/
├── model/
│   ├── 1a/
│   │   ├── 1ad234316a60422eb12edbe25353c051.glb
│   │   └── 1a8f9e2d4c5b6a7e8f9d0c1b2a3e4d5f.glb
│   ├── 2b/
│   │   └── 2bf4e6a8d9c7b5e3f1a4d7c8b9e2f5a6.glb
│   └── ...
```

### 保持目录结构（--preserve-structure）

使用此选项时，会保持原始的相对路径：

```
OSS存储桶/
├── model/
│   ├── model/
│   │   ├── 1a/
│   │   │   └── 1ad234316a60422eb12edbe25353c051.glb
│   │   ├── 2b/
│   │   │   └── 2bf4e6a8d9c7b5e3f1a4d7c8b9e2f5a6.glb
│   │   └── ...
```

## 性能配置

可以通过环境变量调整上传性能：

```bash
# .env文件中的配置
UPLOAD_CONCURRENT=5    # 同时上传的文件数（建议1-10）
UPLOAD_RETRY=3         # 上传失败时的重试次数
```

**建议配置：**
- 网络良好：`UPLOAD_CONCURRENT=10`
- 网络一般：`UPLOAD_CONCURRENT=5`
- 网络较差：`UPLOAD_CONCURRENT=3`

## 输出信息

脚本会显示详细的进度信息：

```
🔗 测试OSS连接...
✅ OSS连接测试成功

🔍 扫描文件: model/**/*.glb
📁 找到 125 个GLB/GLTF文件

🚀 开始批量上传 125 个文件...

⬆️  上传: model/1a/1ad234316a60422eb12edbe25353c051.glb -> model/1a/1ad234316a60422eb12edbe25353c051.glb (1.2 MB)
✅ 上传成功: model/1a/1ad234316a60422eb12edbe25353c051.glb

📊 [1/125] 1ad234316a60422eb12edbe25353c051.glb - 100%

📊 上传统计:
⏱️  总耗时: 45.67 秒
📁 扫描文件: 125
✅ 上传成功: 120
⏭️  跳过文件: 3
❌ 上传失败: 2
⚡ 上传速度: 2.63 文件/秒
```

## 错误处理

### 常见错误及解决方案

1. **OSS连接失败**
   ```
   ❌ OSS连接测试失败: The bucket you access does not exist
   ```
   - 检查 `OSS_BUCKET` 配置是否正确
   - 确认存储桶是否存在且在指定区域

2. **权限错误**
   ```
   ❌ 上传失败: Access denied
   ```
   - 检查AccessKey权限是否足够
   - 确认对存储桶有写入权限

3. **网络超时**
   ```
   ❌ 上传失败: Network timeout
   ```
   - 降低 `UPLOAD_CONCURRENT` 值
   - 增加 `UPLOAD_RETRY` 值
   - 检查网络连接

## 最佳实践

1. **首次上传前测试连接**
   ```bash
   npm run upload -- --test
   ```

2. **分批次上传大量文件**
   ```bash
   # 先上传一个子目录测试
   npm run upload "model/1a/*.glb"
   
   # 确认无误后再批量上传
   npm run upload "model/**/*.glb"
   ```

3. **上传前备份重要文件**
   确保本地有完整的文件备份，以防上传过程中出现问题

4. **监控上传进度**
   对于大量文件，建议在稳定网络环境下进行，并留意上传统计信息

5. **定期检查OSS存储桶**
   - 监控存储空间使用情况
   - 设置合适的生命周期规则
   - 配置访问日志以便排查问题

## 故障排除

如果遇到问题，请按以下步骤排查：

1. 验证环境变量配置
2. 测试OSS连接 (`--test`)
3. 检查网络连接
4. 查看详细错误信息
5. 降低并发数重试
6. 检查阿里云控制台的错误日志

如需帮助，请提供完整的错误信息和配置（隐藏敏感信息）。