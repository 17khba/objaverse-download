#!/usr/bin/env python3
"""
指定 UID 下载脚本 - 支持下载特定的 UID 列表
"""

import argparse
import json
import os
import sys
from typing import List, Dict, Any

import objaverse_download
from shard_download import create_custom_structure


def parse_args():
    parser = argparse.ArgumentParser(description="下载指定 UID 的 3D 模型")
    
    parser.add_argument(
        "uids",
        nargs="+",
        help="要下载的 UID 列表，用空格分隔"
    )
    
    parser.add_argument(
        "--output",
        type=str,
        default="./downloads",
        help="输出目录（默认：./downloads）"
    )
    
    parser.add_argument(
        "--processes",
        type=int,
        default=4,
        help="下载进程数（默认：4）"
    )
    
    parser.add_argument(
        "--log-file",
        type=str,
        help="生成日志文件路径（可选）"
    )
    
    parser.add_argument(
        "--custom-structure",
        action="store_true",
        help="使用自定义文件结构（按UID前缀组织）"
    )
    
    parser.add_argument(
        "--from-failed-log",
        type=str,
        help="从失败日志文件中提取UID（格式：retry_download_log_*.json）"
    )
    
    return parser.parse_args()


def extract_failed_uids_from_log(log_file: str) -> List[str]:
    """从重试日志文件中提取失败的UID"""
    failed_uids = []
    
    try:
        with open(log_file, 'r', encoding='utf-8') as f:
            data = json.load(f)
        
        results = data.get('results', {})
        for uid, result in results.items():
            if result.get('status') == 'failed':
                failed_uids.append(uid)
                print(f"发现失败UID: {uid}")
                if 'final_error' in result:
                    print(f"  错误: {result['final_error']}")
        
        print(f"\n从日志文件中找到 {len(failed_uids)} 个失败的UID")
        return failed_uids
        
    except Exception as e:
        print(f"❌ 解析日志文件失败: {e}")
        return []


def download_specific_uids(
    uids: List[str],
    output_dir: str,
    processes: int = 4,
    use_custom_structure: bool = False
) -> Dict[str, Any]:
    """下载指定的UID列表"""
    
    print(f"📥 开始下载 {len(uids)} 个指定的模型...")
    print(f"输出目录: {output_dir}")
    print(f"并发进程: {processes}")
    print(f"使用自定义结构: {use_custom_structure}")
    print()
    
    # 确保输出目录存在
    os.makedirs(output_dir, exist_ok=True)
    
    results = {}
    
    try:
        if use_custom_structure:
            # 使用自定义文件结构
            print("使用自定义文件结构下载...")
            
            # 先使用默认方式下载到缓存
            objects = objaverse_download.load_objects(uids, download_processes=processes)
            annotations = objaverse_download.load_annotations(uids)
            
            # 然后创建自定义结构
            for uid in uids:
                if uid in objects and uid in annotations:
                    try:
                        custom_paths = create_custom_structure(
                            output_dir, uid, objects[uid], annotations[uid]
                        )
                        results[uid] = {
                            "status": "success",
                            "result": custom_paths
                        }
                        print(f"✅ 成功: {uid}")
                    except Exception as e:
                        results[uid] = {
                            "status": "failed",
                            "error": str(e)
                        }
                        print(f"❌ 失败: {uid} - {e}")
                else:
                    results[uid] = {
                        "status": "failed",
                        "error": "下载失败或元数据缺失"
                    }
                    print(f"❌ 失败: {uid} - 下载失败或元数据缺失")
        else:
            # 使用默认下载方式
            print("使用默认下载方式...")
            objects = objaverse_download.load_objects(uids, download_processes=processes)
            annotations = objaverse_download.load_annotations(uids)
            
            for uid in uids:
                if uid in objects:
                    results[uid] = {
                        "status": "success",
                        "result": {
                            "glb": objects[uid],
                            "metadata": annotations.get(uid)
                        }
                    }
                    print(f"✅ 成功: {uid}")
                else:
                    results[uid] = {
                        "status": "failed",
                        "error": "下载失败"
                    }
                    print(f"❌ 失败: {uid}")
                    
    except Exception as e:
        print(f"❌ 下载过程中发生错误: {e}")
        for uid in uids:
            if uid not in results:
                results[uid] = {
                    "status": "failed",
                    "error": str(e)
                }
    
    return results


def generate_log(args, results: Dict[str, Any]) -> None:
    """生成下载日志"""
    
    if not args.log_file:
        return
    
    # 统计结果
    success_count = sum(1 for r in results.values() if r.get('status') == 'success')
    failed_count = len(results) - success_count
    
    log_data = {
        "args": {
            "uids": args.uids if not args.from_failed_log else f"from_log:{args.from_failed_log}",
            "output": args.output,
            "processes": args.processes,
            "custom_structure": args.custom_structure
        },
        "results": results,
        "summary": {
            "total": len(results),
            "success": success_count,
            "failed": failed_count
        }
    }
    
    try:
        with open(args.log_file, 'w', encoding='utf-8') as f:
            json.dump(log_data, f, indent=2, ensure_ascii=False)
        print(f"📄 日志已保存到: {args.log_file}")
    except Exception as e:
        print(f"❌ 保存日志失败: {e}")


def main():
    args = parse_args()
    
    # 确定要下载的UID列表
    if args.from_failed_log:
        if not os.path.exists(args.from_failed_log):
            print(f"❌ 日志文件不存在: {args.from_failed_log}")
            sys.exit(1)
        
        uids = extract_failed_uids_from_log(args.from_failed_log)
        if not uids:
            print("❌ 没有找到失败的UID")
            sys.exit(1)
    else:
        uids = args.uids
    
    print(f"📋 要下载的UID: {uids}")
    print("-" * 60)
    
    # 执行下载
    results = download_specific_uids(
        uids=uids,
        output_dir=args.output,
        processes=args.processes,
        use_custom_structure=args.custom_structure
    )
    
    # 生成日志
    generate_log(args, results)
    
    # 显示结果汇总
    success_count = sum(1 for r in results.values() if r.get('status') == 'success')
    failed_count = len(results) - success_count
    
    print()
    print("=" * 60)
    print("📊 下载结果汇总")
    print("=" * 60)
    print(f"总数: {len(results)}")
    print(f"成功: {success_count}")
    print(f"失败: {failed_count}")
    
    if failed_count > 0:
        print("\n❌ 失败的UID:")
        for uid, result in results.items():
            if result.get('status') == 'failed':
                error = result.get('error', '未知错误')
                print(f"  {uid}: {error}")
    
    print("=" * 60)


if __name__ == "__main__":
    main()