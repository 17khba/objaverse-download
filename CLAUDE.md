# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an Objaverse 3D model download and processing system that provides tools for batch downloading GLB format 3D models from the Objaverse dataset. The system supports parallel processing, intelligent retry mechanisms, and comprehensive logging.

## Core Architecture

### Python Components
- **objaverse_download.py**: Core library providing the main download API (`load_objects`, `load_annotations`, `load_uids`)
- **shard_download.py**: Shard-based downloading with custom file organization (downloads models in chunks with UID-based directory structure)
- **retry_failed.py**: Retry mechanism for failed downloads with configurable parameters
- **filter_success.py**: Log analysis and filtering tools for processing download results
- **test_download.py**: Testing utilities for validating download functionality

### JavaScript Components  
- **scripts/upload-model.js**: Alibaba Cloud OSS uploader for model files with concurrent upload support

### File Organization
Downloaded models are organized by UID prefix:
```
downloads/model/
├── 84/
│   ├── 8476c4170df24cf5bbe6967222d1a42d.glb
│   ├── 8476c4170df24cf5bbe6967222d1a42d.m.metadata.json
│   └── 8476c4170df24cf5bbe6967222d1a42d.thumb.jpeg
└── 8f/
    ├── 8ff7f1f2465347cd8b80c9b206c2781e.glb
    └── 8ff7f1f2465347cd8b80c9b206c2781e.m.metadata.json
```

## Common Commands

### Development Setup
```bash
# Install dependencies using uv (recommended)
uv sync

# Traditional installation
pip install -r requirements.txt
```

### Testing and Quality
```bash
# Run tests
uv run pytest

# Code formatting
uv run black .

# Type checking  
uv run mypy .

# Linting
uv run flake8
```

### Core Download Operations
```bash
# Quick test download (3 models)
uv run objaverse-test

# Shard download with range
uv run objaverse-shard --start 0 --end 100 --output ./downloads --processes 4

# Retry failed downloads
uv run objaverse-retry download_log_0_100.json --max-retries 5 --retry-delay 10

# Analyze download logs
uv run objaverse-filter download_log_0_100.json --show-failed
```

### JavaScript Upload Tools
```bash
# Upload models to OSS (requires .env configuration)
node scripts/upload-model.js

# Retry failed uploads from error log
node scripts/retry-upload.js logs/upload-error.log
```

## Key Configuration

### Python Package (pyproject.toml)
- Entry points defined for all CLI tools: `objaverse-download`, `objaverse-test`, `objaverse-shard`, `objaverse-retry`, `objaverse-filter`
- Development dependencies include pytest, black, flake8, mypy
- Configured for Python 3.8+ support

### Environment Variables (for upload script)
- `OSS_REGION`, `OSS_ACCESS_KEY_ID`, `OSS_ACCESS_KEY_SECRET`, `OSS_BUCKET`
- `OSS_BUCKET_PATH`, `UPLOAD_CONCURRENT`, `UPLOAD_RETRY`

## Download Workflow Patterns

### Large Batch Downloads
1. Use shard downloading: `uv run objaverse-shard --start X --end Y`
2. Check for failures: `uv run objaverse-filter download_log_X_Y.json --show-failed`
3. Retry failures: `uv run objaverse-retry filtered_failed_download_log_X_Y.json`
4. Verify final results: `uv run objaverse-filter retry_*.json --show-failed`

### Error Handling
- SSL/timeout errors: Reduce concurrency, increase retry delays
- Network instability: Use smaller batch sizes and longer retry intervals
- Storage issues: Monitor disk space, download in smaller chunks

## Logging System

Download logs are stored as JSON files with structure:
- `args`: Command arguments used
- `results`: Per-object download results with file paths or error messages  
- `summary`: Success/error counts and totals

Log files follow naming pattern: `download_log_{start}_{end}.json` and `retry_*.json`

## Development Notes

- The system uses multiprocessing for parallel downloads
- Default cache location: `~/.objaverse/hf-objaverse-v1/`
- Models are downloaded from HuggingFace datasets: `https://huggingface.co/datasets/allenai/objaverse`
- Support for custom output directories and file organization
- Built-in progress tracking with tqdm
- Comprehensive error reporting and recovery mechanisms