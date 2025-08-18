#!/usr/bin/env python3
"""
过滤成功下载记录脚本 - 从日志文件中移除成功下载的条目，只保留失败的记录
"""

import argparse
import json
from pathlib import Path
from typing import Dict, List


def filter_success_entries(log_file: str, output_file: str = None, keep_success: bool = False) -> Dict:
    """
    过滤掉成功的下载记录，只保留失败的条目
    
    Args:
        log_file: 原始日志文件路径
        output_file: 输出文件路径，如果不指定则自动生成
        keep_success: 如果为True则保留成功记录，过滤失败记录
    
    Returns:
        过滤后的日志数据
    """
    print(f"正在分析日志文件: {log_file}")
    
    # 加载原始日志
    with open(log_file, 'r', encoding='utf-8') as f:
        log_data = json.load(f)
    
    original_results = log_data['results']
    
    # 分离成功和失败的记录
    success_entries = {}
    failed_entries = {}
    
    for uid, result in original_results.items():
        if 'error' in result:
            failed_entries[uid] = result
        else:
            success_entries[uid] = result
    
    print(f"原始记录统计:")
    print(f"  总数: {len(original_results)}")
    print(f"  成功: {len(success_entries)}")
    print(f"  失败: {len(failed_entries)}")
    
    # 根据参数决定保留哪些记录
    if keep_success:
        filtered_results = success_entries
        filter_type = "success"
        print(f"\n保留成功记录: {len(filtered_results)} 个")
    else:
        filtered_results = failed_entries
        filter_type = "failed"
        print(f"\n保留失败记录: {len(filtered_results)} 个")
    
    # 构建新的日志数据
    filtered_log_data = {
        'original_log': log_file,
        'filter_type': filter_type,
        'args': log_data['args'].copy(),
        'results': filtered_results,
        'summary': {
            'total': len(filtered_results),
            'original_total': len(original_results),
            'original_success': len(success_entries),
            'original_failed': len(failed_entries)
        }
    }
    
    # 更新args中的范围以反映实际的过滤结果
    if filtered_results:
        # 根据保留的记录更新start和end（虽然这在过滤后的记录中可能不连续）
        filtered_log_data['args']['filtered_count'] = len(filtered_results)
    
    # 确定输出文件名
    if output_file is None:
        log_path = Path(log_file)
        if keep_success:
            output_file = log_path.parent / f"filtered_success_{log_path.stem}.json"
        else:
            output_file = log_path.parent / f"filtered_failed_{log_path.stem}.json"
    
    # 保存过滤后的日志
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(filtered_log_data, f, ensure_ascii=False, indent=2)
    
    print(f"过滤后的日志已保存到: {output_file}")
    
    return filtered_log_data


def show_failed_details(log_file: str):
    """
    显示失败记录的详细信息
    
    Args:
        log_file: 日志文件路径
    """
    with open(log_file, 'r', encoding='utf-8') as f:
        log_data = json.load(f)
    
    failed_entries = {uid: result for uid, result in log_data['results'].items() if 'error' in result}
    
    if not failed_entries:
        print("没有发现失败的下载记录")
        return
    
    print(f"失败的下载记录 ({len(failed_entries)} 个):")
    print("-" * 80)
    
    # 按错误类型分组
    error_groups = {}
    for uid, result in failed_entries.items():
        error_msg = result['error']
        if error_msg not in error_groups:
            error_groups[error_msg] = []
        error_groups[error_msg].append(uid)
    
    for error_msg, uids in error_groups.items():
        print(f"\n错误类型: {error_msg}")
        print(f"影响的对象数量: {len(uids)}")
        print("UID列表:")
        for uid in uids:
            print(f"  {uid}")


def convert_to_shard_args(filtered_log_file: str) -> Dict:
    """
    将过滤后的日志转换为分片下载参数
    
    Args:
        filtered_log_file: 过滤后的日志文件路径
    
    Returns:
        建议的分片下载参数
    """
    with open(filtered_log_file, 'r', encoding='utf-8') as f:
        log_data = json.load(f)
    
    failed_uids = list(log_data['results'].keys())
    
    if not failed_uids:
        return {}
    
    # 建议参数
    original_args = log_data['args']
    suggested_args = {
        'description': '基于失败记录的重新下载建议',
        'total_failed': len(failed_uids),
        'output_dir': original_args.get('output', './downloads'),
        'processes': min(original_args.get('processes', 4), 2),  # 减少并发数以提高稳定性
        'retry_suggestions': {
            'max_retries': 5,
            'retry_delay': 10,
            'use_smaller_batches': True,
            'command_template': f'uv run objaverse-retry {filtered_log_file} --max-retries 5 --retry-delay 10'
        }
    }
    
    print(f"\n重新下载建议:")
    print(f"  失败对象总数: {suggested_args['total_failed']}")
    print(f"  建议输出目录: {suggested_args['output_dir']}")
    print(f"  建议并发数: {suggested_args['processes']} (已减少以提高稳定性)")
    print(f"  建议命令:")
    print(f"    {suggested_args['retry_suggestions']['command_template']}")
    
    return suggested_args


def main():
    """主函数"""
    parser = argparse.ArgumentParser(description="过滤下载日志中的成功/失败记录")
    parser.add_argument("log_file", help="下载日志文件路径")
    parser.add_argument("--output", "-o", help="输出文件路径 (默认自动生成)")
    parser.add_argument("--keep-success", action="store_true", help="保留成功记录而不是失败记录")
    parser.add_argument("--show-failed", action="store_true", help="显示失败记录的详细信息")
    parser.add_argument("--suggest-retry", action="store_true", help="生成重试建议")
    
    args = parser.parse_args()
    
    # 检查日志文件是否存在
    if not Path(args.log_file).exists():
        print(f"错误: 日志文件不存在: {args.log_file}")
        return 1
    
    if args.show_failed:
        # 显示失败记录详情
        show_failed_details(args.log_file)
        return 0
    
    # 过滤记录
    filtered_data = filter_success_entries(
        log_file=args.log_file,
        output_file=args.output,
        keep_success=args.keep_success
    )
    
    if args.suggest_retry and not args.keep_success:
        # 生成重试建议（仅当保留失败记录时）
        output_file = args.output
        if output_file is None:
            log_path = Path(args.log_file)
            output_file = log_path.parent / f"filtered_failed_{log_path.stem}.json"
        
        convert_to_shard_args(output_file)
    
    return 0


if __name__ == "__main__":
    exit(main())