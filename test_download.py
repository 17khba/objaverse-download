#!/usr/bin/env python3
import objaverse_download

def test_download():
    """测试下载功能"""
    print("开始测试 Objaverse 下载功能...")
    
    # 获取少量 UID 进行测试
    all_uids = objaverse_download.load_uids()
    print(f"获取到 {len(all_uids)} 个对象")
    test_uids = all_uids[:3]  # 只下载 3 个对象进行测试
    
    print(f"\n1. 测试加载注释功能...")
    annotations = objaverse_download.load_annotations(test_uids)
    print(f"成功加载 {len(annotations)} 个对象的注释信息")
    
    print(f"\n2. 测试下载对象功能...")
    print(f"将下载 {len(test_uids)} 个测试对象")
    objects = objaverse_download.load_objects(test_uids, download_processes=1)
    print(f"成功下载 {len(objects)} 个对象：")
    for uid, path in objects.items():
        print(f"  - {uid}: {path}")
    
    print(f"\n3. 测试加载 LVIS 注释功能...")
    try:
        lvis_annotations = objaverse_download.load_lvis_annotations()
        print(f"成功加载 LVIS 注释，包含 {len(lvis_annotations)} 个类别")
        # 显示前几个类别作为示例
        categories = list(lvis_annotations.keys())[:5]
        print("示例类别：")
        for category in categories:
            count = len(lvis_annotations[category])
            print(f"  - {category}: {count} 个对象")
    except Exception as e:
        print(f"加载 LVIS 注释时出错: {e}")
    
    print(f"\n测试完成！")

if __name__ == "__main__":
    test_download()