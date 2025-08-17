#!/usr/bin/env python3
"""
分片下载脚本 - 支持手动配置分片下载和自定义文件结构存储
"""

import argparse
import glob
import gzip
import json
import multiprocessing
import os
import urllib.request
import warnings
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from tqdm import tqdm
import objaverse_download


def create_custom_structure(base_path: str, uid: str, glb_path: str, metadata: Dict[str, Any]) -> Dict[str, str]:
    """
    创建自定义文件结构并移动/复制文件
    
    Args:
        base_path: 基础存储路径
        uid: 对象唯一标识符
        glb_path: GLB文件的原始路径
        metadata: 对象元数据
    
    Returns:
        创建的文件路径字典
    """
    # 使用UID前2位作为前缀目录
    uid_prefix = uid[:2]
    model_dir = Path(base_path) / "model" / uid_prefix
    model_dir.mkdir(parents=True, exist_ok=True)
    
    # 目标文件路径
    target_glb = model_dir / f"{uid}.glb"
    target_metadata = model_dir / f"{uid}.m.metadata.json"
    target_thumb = model_dir / f"{uid}.thumb.jpeg"
    
    # 复制GLB文件
    if os.path.exists(glb_path):
        import shutil
        shutil.copy2(glb_path, target_glb)
    
    # 保存元数据
    with open(target_metadata, 'w', encoding='utf-8') as f:
        json.dump(metadata, f, ensure_ascii=False, indent=2)
    
    # 下载缩略图（如果有的话）
    thumb_url = None
    if 'thumbnails' in metadata and metadata['thumbnails']:
        # 获取第一个缩略图URL
        if isinstance(metadata['thumbnails'], list) and len(metadata['thumbnails']) > 0:
            thumb_url = metadata['thumbnails'][0].get('url')
        elif isinstance(metadata['thumbnails'], dict):
            thumb_url = metadata['thumbnails'].get('url')
    
    if thumb_url:
        try:
            urllib.request.urlretrieve(thumb_url, target_thumb)
        except Exception as e:
            print(f"下载缩略图失败 {uid}: {e}")
            target_thumb = None
    else:
        target_thumb = None
    
    return {
        'glb': str(target_glb) if target_glb.exists() else None,
        'metadata': str(target_metadata),
        'thumbnail': str(target_thumb) if target_thumb and target_thumb.exists() else None
    }


def download_single_object(uid: str, output_dir: str, annotations_cache: Dict[str, Any]) -> Dict[str, str]:
    """
    下载单个对象并立即存储
    
    Args:
        uid: 对象唯一标识符
        output_dir: 输出目录
        annotations_cache: 元数据缓存
    
    Returns:
        文件路径字典
    """
    try:
        # 下载单个GLB文件
        objects = objaverse_download.load_objects([uid], download_processes=1)
        
        if uid in objects and uid in annotations_cache:
            # 立即创建自定义文件结构
            file_paths = create_custom_structure(
                output_dir, 
                uid, 
                objects[uid], 
                annotations_cache[uid]
            )
            print(f"✓ 已完成: {uid}")
            return file_paths
        else:
            error_msg = 'Missing object or annotation'
            print(f"✗ 失败: {uid} - {error_msg}")
            return {'error': error_msg}
    except Exception as e:
        error_msg = str(e)
        print(f"✗ 错误: {uid} - {error_msg}")
        return {'error': error_msg}


def download_shard(
    start_idx: int,
    end_idx: int,
    output_dir: str = "./downloads",
    processes: int = 4,
    filter_prefix: Optional[str] = None
) -> Dict[str, Dict[str, str]]:
    """
    下载指定范围的对象分片（边下载边存储）
    
    Args:
        start_idx: 开始索引
        end_idx: 结束索引
        output_dir: 输出目录
        processes: 并行进程数（注意：边下载边存储模式下，建议使用较小的进程数）
        filter_prefix: 过滤前缀（如 "000-000"）
    
    Returns:
        下载结果字典
    """
    print(f"开始下载分片 {start_idx}-{end_idx} (边下载边存储模式)")
    
    # 获取所有UIDs
    all_uids = objaverse_download.load_uids()
    
    # 应用过滤器
    if filter_prefix:
        object_paths = objaverse_download._load_object_paths()
        filtered_uids = [uid for uid in all_uids if object_paths[uid].startswith(f"glbs/{filter_prefix}")]
        print(f"过滤后剩余 {len(filtered_uids)} 个对象（前缀: {filter_prefix}）")
        all_uids = filtered_uids
    
    # 选择分片
    shard_uids = all_uids[start_idx:end_idx]
    print(f"当前分片包含 {len(shard_uids)} 个对象")
    
    if not shard_uids:
        print("没有找到要下载的对象")
        return {}
    
    # 批量加载元数据（这个比较轻量，可以一次性加载）
    print("加载元数据...")
    annotations = objaverse_download.load_annotations(shard_uids)
    print(f"成功加载 {len(annotations)} 个对象的元数据")
    
    # 逐个下载并存储
    print("开始逐个下载并存储...")
    results = {}
    
    # 如果processes > 1，使用多进程处理
    if processes > 1:
        print(f"使用 {processes} 个进程并行处理")
        from multiprocessing import Pool
        
        # 准备参数列表
        args_list = [(uid, output_dir, annotations) for uid in shard_uids]
        
        with Pool(processes=processes) as pool:
            # 使用starmap并行执行
            pool_results = pool.starmap(download_single_object, args_list)
            
        # 组装结果
        for uid, result in zip(shard_uids, pool_results):
            results[uid] = result
    else:
        # 单进程顺序处理
        for uid in tqdm(shard_uids, desc="下载进度"):
            results[uid] = download_single_object(uid, output_dir, annotations)
    
    return results


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="Objaverse 分片下载工具")
    parser.add_argument("--start", type=int, required=True, help="开始索引")
    parser.add_argument("--end", type=int, required=True, help="结束索引")
    parser.add_argument("--output", "-o", default="./downloads", help="输出目录 (默认: ./downloads)")
    parser.add_argument("--processes", "-p", type=int, default=4, help="并行进程数 (默认: 4)")
    parser.add_argument("--filter", "-f", help="过滤前缀，如 '000-000'")
    parser.add_argument("--dry-run", action="store_true", help="仅显示将要下载的对象数量，不实际下载")
    
    args = parser.parse_args()
    
    if args.dry_run:
        # 干运行模式
        all_uids = objaverse_download.load_uids()
        if args.filter:
            object_paths = objaverse_download._load_object_paths()
            filtered_uids = [uid for uid in all_uids if object_paths[uid].startswith(f"glbs/{args.filter}")]
            all_uids = filtered_uids
        
        shard_uids = all_uids[args.start:args.end]
        print(f"干运行模式:")
        print(f"  总对象数: {len(all_uids)}")
        print(f"  分片范围: {args.start}-{args.end}")
        print(f"  分片大小: {len(shard_uids)}")
        print(f"  输出目录: {args.output}")
        print(f"  并行进程: {args.processes}")
        if args.filter:
            print(f"  过滤前缀: {args.filter}")
        return
    
    # 实际下载
    results = download_shard(
        start_idx=args.start,
        end_idx=args.end,
        output_dir=args.output,
        processes=args.processes,
        filter_prefix=args.filter
    )
    
    # 统计结果
    success_count = sum(1 for r in results.values() if 'error' not in r)
    error_count = len(results) - success_count
    
    print(f"\n下载完成!")
    print(f"成功: {success_count}")
    print(f"失败: {error_count}")
    
    # 保存下载日志
    log_file = Path(args.output) / f"download_log_{args.start}_{args.end}.json"
    with open(log_file, 'w', encoding='utf-8') as f:
        json.dump({
            'args': vars(args),
            'results': results,
            'summary': {
                'success': success_count,
                'error': error_count,
                'total': len(results)
            }
        }, f, ensure_ascii=False, indent=2)
    
    print(f"下载日志已保存到: {log_file}")


if __name__ == "__main__":
    main()