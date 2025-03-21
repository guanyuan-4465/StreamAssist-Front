import os
import shutil
import subprocess
import sys
from pathlib import Path
import requests
import zipfile

def get_chrome_files():
    """获取 Chrome 相关文件"""
    print("获取 Chrome 文件...")

    # 创建临时目录用于存放Chrome文件
    build_dir = Path('build')
    chrome_temp_dir = build_dir / 'chrome'

    # 如果目标目录已存在，先删除它
    if chrome_temp_dir.exists():
        print(f"临时Chrome目录已存在，正在删除: {chrome_temp_dir}")
        shutil.rmtree(chrome_temp_dir)

    # 创建临时目录
    chrome_temp_dir.mkdir(parents=True, exist_ok=True)

    # 源Chrome目录
    chrome_dir = Path(r"C:\Program Files\Google\Chrome\Application")

    if not chrome_dir.exists():
        raise Exception(f"找不到 Chrome 目录: {chrome_dir}")

    # 复制整个目录到临时位置
    print(f"正在复制 Chrome 文件从 {chrome_dir} 到 {chrome_temp_dir}...")
    shutil.copytree(chrome_dir, chrome_temp_dir, dirs_exist_ok=True)

    print("Chrome 文件已复制到临时目录")
    return chrome_temp_dir

def clean_build():
    """清理旧的构建文件"""
    print("清理旧的构建文件...")
    # 清理临时构建目录
    build_dirs = ['build', 'dist', 'chrome-win']
    for dir_name in build_dirs:
        if os.path.exists(dir_name):
            shutil.rmtree(dir_name)

    # 删除spec文件
    spec_files = ['StreamAssist.spec']
    for spec_file in spec_files:
        if os.path.exists(spec_file):
            os.remove(spec_file)

    print("旧的构建文件已清理")

def copy_resource_dirs():
    """确保资源目录存在并包含必要文件"""
    print("检查资源目录...")

    # 定义需要复制的资源目录
    resource_dirs = [
        'src/cookie_settings',
        'src/customer',
        'src/knowledge_base',
        'src/models',
        'src/prompts'
    ]

    # 确保目录存在
    for dir_path in resource_dirs:
        os.makedirs(dir_path, exist_ok=True)

    print("资源目录检查完成")

def create_spec_file():
    """创建 PyInstaller spec 文件"""
    print("创建 PyInstaller spec 文件...")

    # 收集所有资源文件
    resource_dirs = [
        ('src/cookie_settings', 'resource/cookie_settings'),
        ('src/customer', 'resource/customer'),
        ('src/knowledge_base', 'resource/knowledge_base'),
        ('src/models', 'resource/models'),
        ('src/prompts', 'resource/prompts')
    ]

    # 构建 datas 列表
    datas_str = '[\n'

    # 添加资源目录
    for src_dir, dest_dir in resource_dirs:
        if os.path.exists(src_dir):
            datas_str += f"    ('{src_dir}', '{dest_dir}'),\n"

    # 添加Chrome文件
    datas_str += "    ('build/chrome', 'chrome'),\n"
    datas_str += ']'

    # 创建spec文件
    spec_content = f"""# -*- mode: python ; coding: utf-8 -*-
import sys
from pathlib import Path

# 添加资源文件路径处理
def get_resource_path(relative_path):
    if hasattr(sys, '_MEIPASS'):
        return os.path.join(sys._MEIPASS, 'resource', relative_path)
    return os.path.join(os.path.abspath('.'), relative_path)

block_cipher = None

a = Analysis(
    ['src/stream_assist.py'],
    pathex=[],
    binaries=[],
    datas={datas_str},
    hiddenimports=[
        # Project Specific Modules
        'src',
        'src.utils',
        'src.utils.douyin_proto',
        'src.utils.document_reader',
        'src.utils.check_environment',
        'src.utils.shared_queue',
        'src.utils.save_cookies',
        'src.utils.livewhisper',
        'src.config',
        'src.config.settings',
        'src.client',
        'src.client.douyin_client',
        'src.client.tiktok_client',

        # Web Framework & Socket
        'flask',
        'flask_cors',
        'flask_socketio',
        'engineio.async_gevent',
        'engineio.async_drivers.threading',
        'gevent',

        # 其他依赖保持不变...
        # ... existing imports ...
    ],
    hookspath=[],
    hooksconfig={{}},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name='StreamAssist',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,
    disable_windowed_traceback=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='StreamAssist'
)
"""

    with open('StreamAssist.spec', 'w', encoding='utf-8') as f:
        f.write(spec_content)

    print("已创建 spec 文件")

def build_executable():
    """构建可执行文件"""
    print("开始构建可执行文件...")
    try:
        subprocess.run(['pyinstaller', 'StreamAssist.spec'], check=True)
        print("构建完成")
    except subprocess.CalledProcessError as e:
        print(f"构建失败: {e}")
        sys.exit(1)
    except Exception as e:
        print(f"构建过程中出错: {e}")
        sys.exit(1)

def main():
    try:
        # 清理旧的构建文件
        clean_build()

        # 确保资源目录存在
        copy_resource_dirs()

        # 获取 Chrome 文件（在创建spec文件之前）
        get_chrome_files()

        # 创建新的 spec 文件
        create_spec_file()

        # 构建可执行文件
        build_executable()

        # 清理临时文件
        if os.path.exists('launcher.py'):
            os.remove('launcher.py')

        print("\n构建完成！可执行文件位于 dist/StreamAssist 目录中")
        print("1. StreamAssist.exe - 原始打包程序")
    except Exception as e:
        print(f"构建过程出错: {e}")
        sys.exit(1)

if __name__ == '__main__':
    main()
