#!/usr/bin/env python3
"""
重试失败下载脚本 - 从日志文件中提取失败的对象并重新下载
"""

import argparse
import json
import time
from pathlib import Path
from typing import Dict, List

import objaverse_download
from shard_download import download_single_object


def load_failed_uids_from_log(log_file: str) -> List[str]:
    """
    从日志文件中提取失败的UID列表
    
    Args:
        log_file: 日志文件路径
    
    Returns:
        失败的UID列表
    """
    with open(log_file, 'r', encoding='utf-8') as f:
        log_data = json.load(f)
    
    failed_uids = []
    for uid, result in log_data['results'].items():
        if 'error' in result:
            failed_uids.append(uid)
    
    return failed_uids


def retry_failed_downloads(
    log_file: str,
    output_dir: str = None,
    max_retries: int = 3,
    retry_delay: int = 5
) -> Dict[str, Dict]:
    """
    重试失败的下载
    
    Args:
        log_file: 日志文件路径
        output_dir: 输出目录，如果不指定则使用日志中的原始输出目录
        max_retries: 最大重试次数
        retry_delay: 重试间隔（秒）
    
    Returns:
        重试结果字典
    """
    print(f"正在分析日志文件: {log_file}")
    
    # 加载日志数据
    with open(log_file, 'r', encoding='utf-8') as f:
        log_data = json.load(f)
    
    # 获取失败的UID
    failed_uids = load_failed_uids_from_log(log_file)
    print(f"发现 {len(failed_uids)} 个失败的下载记录")
    
    if not failed_uids:
        print("没有发现失败的下载记录")
        return {}
    
    # 确定输出目录
    if output_dir is None:
        output_dir = log_data['args']['output']
    print(f"输出目录: {output_dir}")
    
    # 显示失败的UID和错误信息
    print("\n失败的下载记录:")
    for uid in failed_uids:
        error_msg = log_data['results'][uid]['error']
        print(f"  {uid}: {error_msg}")
    
    # 加载元数据
    print(f"\n正在加载 {len(failed_uids)} 个对象的元数据...")
    annotations = objaverse_download.load_annotations(failed_uids)
    print(f"成功加载 {len(annotations)} 个对象的元数据")
    
    # 重试下载
    print(f"\n开始重试下载 (最大重试次数: {max_retries}, 重试间隔: {retry_delay}秒)")
    results = {}
    
    for uid in failed_uids:
        print(f"\n正在重试: {uid}")
        original_error = log_data['results'][uid]['error']
        print(f"  原始错误: {original_error}")
        
        success = False
        last_error = None
        
        for attempt in range(max_retries):
            try:
                print(f"  尝试 {attempt + 1}/{max_retries}...")
                
                # 重试下载
                result = download_single_object(uid, output_dir, annotations)
                
                if 'error' not in result:
                    print(f"  ✓ 重试成功!")
                    results[uid] = {
                        'status': 'success',
                        'attempts': attempt + 1,
                        'original_error': original_error,
                        'result': result
                    }
                    success = True
                    break
                else:
                    last_error = result['error']
                    print(f"  ✗ 尝试 {attempt + 1} 失败: {last_error}")
                
            except Exception as e:
                last_error = str(e)
                print(f"  ✗ 尝试 {attempt + 1} 出错: {last_error}")
            
            # 如果不是最后一次尝试，等待重试间隔
            if attempt < max_retries - 1:
                print(f"  等待 {retry_delay} 秒后重试...")
                time.sleep(retry_delay)
        
        if not success:
            print(f"  ✗ 所有重试均失败")
            results[uid] = {
                'status': 'failed',
                'attempts': max_retries,
                'original_error': original_error,
                'final_error': last_error
            }
    
    return results


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="重试失败的Objaverse下载")
    parser.add_argument("log_file", help="下载日志文件路径")
    parser.add_argument("--output", "-o", help="输出目录 (默认使用日志中的原始目录)")
    parser.add_argument("--max-retries", "-r", type=int, default=3, help="最大重试次数 (默认: 3)")
    parser.add_argument("--retry-delay", "-d", type=int, default=5, help="重试间隔秒数 (默认: 5)")
    parser.add_argument("--list-only", action="store_true", help="仅列出失败的UID，不进行重试")
    
    args = parser.parse_args()
    
    # 检查日志文件是否存在
    if not Path(args.log_file).exists():
        print(f"错误: 日志文件不存在: {args.log_file}")
        return 1
    
    if args.list_only:
        # 仅列出失败的UID
        failed_uids = load_failed_uids_from_log(args.log_file)
        print(f"失败的下载记录 ({len(failed_uids)} 个):")
        for uid in failed_uids:
            print(f"  {uid}")
        return 0
    
    # 执行重试
    results = retry_failed_downloads(
        log_file=args.log_file,
        output_dir=args.output,
        max_retries=args.max_retries,
        retry_delay=args.retry_delay
    )
    
    # 统计结果
    success_count = sum(1 for r in results.values() if r['status'] == 'success')
    failed_count = len(results) - success_count
    
    print(f"\n重试完成!")
    print(f"成功: {success_count}")
    print(f"失败: {failed_count}")
    print(f"总计: {len(results)}")
    
    # 保存重试日志
    retry_log_file = Path(args.log_file).parent / f"retry_{Path(args.log_file).stem}.json"
    with open(retry_log_file, 'w', encoding='utf-8') as f:
        json.dump({
            'original_log': args.log_file,
            'args': vars(args),
            'results': results,
            'summary': {
                'success': success_count,
                'failed': failed_count,
                'total': len(results)
            }
        }, f, ensure_ascii=False, indent=2)
    
    print(f"重试日志已保存到: {retry_log_file}")
    
    # 如果还有失败的，显示详细信息
    if failed_count > 0:
        print(f"\n仍然失败的下载:")
        for uid, result in results.items():
            if result['status'] == 'failed':
                print(f"  {uid}: {result['final_error']}")
    
    return 0 if failed_count == 0 else 1


if __name__ == "__main__":
    exit(main())