"""
AI Code Editor - Современный редактор кода с AI
Перед запуском установите зависимости:
pip install Flask flask-cors PyQt5 PyQtWebEngine requests
"""

import sys
import os
import json
from pathlib import Path

# Проверка зависимостей
try:
    from PyQt5.QtWidgets import QApplication, QMainWindow, QMessageBox
    from PyQt5.QtCore import QUrl, QTimer
    from PyQt5.QtWebEngineWidgets import QWebEngineView
except ImportError as e:
    print("=" * 60)
    print("ОШИБКА: Не установлены необходимые модули!")
    print("=" * 60)
    print("\nУстановите зависимости командой:")
    print("\npip install PyQt5 PyQtWebEngine Flask flask-cors requests")
    print("\nИли:")
    print("\npip install -r requirements.txt")
    print("=" * 60)
    input("\nНажмите Enter для выхода...")
    sys.exit(1)

from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
import threading
import requests
import time

# Flask приложение
app = Flask(__name__, 
            template_folder='templates',
            static_folder='static')
CORS(app)

class EditorState:
    """Состояние редактора"""
    def __init__(self):
        self.current_file = None
        self.file_modified = False
        self.config_file = "editor_config.json"
        self.config = self.load_config()
        self.current_directory = None
        
    def load_config(self):
        """Загрузка конфигурации"""
        if os.path.exists(self.config_file):
            try:
                with open(self.config_file, 'r', encoding='utf-8') as f:
                    return json.load(f)
            except:
                pass
        
        return {
            'api_key': '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',
            'selected_model': 'qwen/qwen3-vl-235b-a22b-thinking',
            'models': [
                'qwen/qwen3-vl-235b-a22b-thinking',
                'meta-llama/llama-3.2-3b-instruct:free',
                'google/gemini-2.0-flash-exp:free',
                'anthropic/claude-3.5-sonnet',
                'anthropic/claude-3-haiku',
                'openai/gpt-4-turbo'
            ],
            'last_file': ''
        }
    
    def save_config(self):
        """Сохранение конфигурации"""
        with open(self.config_file, 'w', encoding='utf-8') as f:
            json.dump(self.config, f, indent=2, ensure_ascii=False)

# Глобальное состояние
state = EditorState()

# Flask routes
@app.route('/')
def index():
    """Главная страница"""
    return render_template('index.html')

@app.route('/api/config', methods=['GET'])
def get_config():
    """Получить конфигурацию"""
    return jsonify(state.config)

@app.route('/api/config', methods=['POST'])
def save_config():
    """Сохранить конфигурацию"""
    data = request.json
    state.config.update(data)
    state.save_config()
    return jsonify({'success': True})

@app.route('/api/file/list', methods=['POST'])
def list_files():
    """Список файлов в директории"""
    data = request.json
    path = data.get('path', state.current_directory)
    
    if not path or not os.path.exists(path):
        return jsonify({'error': 'Invalid path'}), 400
    
    try:
        items = []
        for item_name in sorted(os.listdir(path)):
            item_path = os.path.join(path, item_name)
            is_dir = os.path.isdir(item_path)
            
            # Пропускаем скрытые файлы
            if item_name.startswith('.'):
                continue
            
            items.append({
                'name': item_name,
                'path': item_path,
                'is_dir': is_dir,
                'icon': '📁' if is_dir else ('🐍' if item_name.endswith('.py') else '📄')
            })
        
        return jsonify({'items': items, 'current_path': path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/open', methods=['POST'])
def open_file():
    """Открыть файл"""
    data = request.json
    filepath = data.get('path')
    
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            content = f.read()
        
        state.current_file = filepath
        state.file_modified = False
        state.config['last_file'] = filepath
        state.save_config()
        
        return jsonify({
            'success': True,
            'content': content,
            'filename': os.path.basename(filepath),
            'path': filepath
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/save', methods=['POST'])
def save_file():
    """Сохранить файл"""
    data = request.json
    filepath = data.get('path', state.current_file)
    content = data.get('content', '')
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        
        state.current_file = filepath
        state.file_modified = False
        
        return jsonify({'success': True, 'message': 'Файл сохранён'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/new', methods=['POST'])
def new_file():
    """Создать новый файл"""
    data = request.json
    dirpath = data.get('dirpath', state.current_directory)
    filename = data.get('filename')
    
    if not filename:
        return jsonify({'error': 'Filename required'}), 400
    
    filepath = os.path.join(dirpath, filename)
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write('')
        
        return jsonify({'success': True, 'path': filepath})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/delete', methods=['POST'])
def delete_file():
    """Удалить файл или папку"""
    data = request.json
    filepath = data.get('path')
    
    try:
        if os.path.isfile(filepath):
            os.remove(filepath)
        elif os.path.isdir(filepath):
            import shutil
            shutil.rmtree(filepath)
        
        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/rename', methods=['POST'])
def rename_file():
    """Переименовать файл"""
    data = request.json
    old_path = data.get('old_path')
    new_name = data.get('new_name')
    
    try:
        new_path = os.path.join(os.path.dirname(old_path), new_name)
        os.rename(old_path, new_path)
        
        return jsonify({'success': True, 'new_path': new_path})
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/directory/open', methods=['POST'])
def open_directory():
    """Открыть директорию"""
    data = request.json
    path = data.get('path')
    
    if os.path.exists(path) and os.path.isdir(path):
        state.current_directory = path
        return jsonify({'success': True, 'path': path})
    
    return jsonify({'error': 'Invalid directory'}), 400

@app.route('/api/ai/chat', methods=['POST'])
def ai_chat():
    """Отправить сообщение AI"""
    data = request.json
    message = data.get('message', '')
    code = data.get('code', '')
    model = data.get('model', state.config.get('selected_model'))
    
    if not message:
        return jsonify({'error': 'Message required'}), 400
    
    try:
        # Формирование запроса
        full_prompt = f"{message}\n\nКод:\n{code}" if code else message
        
        # API ключ
        api_key = state.config.get('api_key', 'sk-free-models-no-key-needed')
        
        # Запрос к OpenRouter
        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "http://localhost:7783",
            },
            json={
                "model": model,
                "messages": [
                    {
                        "role": "system",
                        "content": "Ты - помощник программиста Python. Когда нужно вернуть код, оборачивай его в блоки ```python. Всегда давай четкие и понятные ответы."
                    },
                    {
                        "role": "user",
                        "content": full_prompt
                    }
                ]
            },
            timeout=120
        )
        
        if response.status_code == 200:
            result = response.json()
            ai_response = result['choices'][0]['message']['content']
            
            return jsonify({
                'success': True,
                'response': ai_response
            })
        else:
            error_msg = f"API Error {response.status_code}"
            try:
                error_data = response.json()
                error_msg = error_data.get('error', {}).get('message', response.text)
            except:
                error_msg = response.text
            
            return jsonify({'error': error_msg}), response.status_code
            
    except requests.exceptions.Timeout:
        return jsonify({'error': 'Request timeout'}), 504
    except requests.exceptions.ConnectionError:
        return jsonify({'error': 'Connection error'}), 503
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/file/save_temp', methods=['POST'])
def save_temp_file():
    """Сохранить временный файл для запуска"""
    data = request.json
    filename = data.get('filename', 'temp_script.py')
    content = data.get('content', '')
    
    # Сохраняем в системную temp папку
    import tempfile
    tmp_dir = tempfile.gettempdir()
    filepath = os.path.join(tmp_dir, filename)
    
    try:
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(content)
        return jsonify({'success': True, 'path': filepath})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/code/run', methods=['POST'])
def run_code():
    """Запустить код"""
    data = request.json
    filepath = data.get('path', state.current_file)
    
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'File not found'}), 400
    
    try:
        import subprocess
        
        # Запуск в отдельном процессе
        if os.name == 'nt':  # Windows
            subprocess.Popen(['python', filepath], creationflags=subprocess.CREATE_NEW_CONSOLE)
        else:  # Linux/Mac
            subprocess.Popen(['python', filepath])
        
        return jsonify({'success': True, 'message': 'Код запущен'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


def run_flask():
    """Запуск Flask сервера"""
    print("🚀 Запуск Flask сервера на http://127.0.0.1:7783")
    app.run(host='127.0.0.1', port=7783, debug=False, use_reloader=False)


class MainWindow(QMainWindow):
    """Главное окно приложения"""
    def __init__(self):
        super().__init__()
        self.setWindowTitle("AI Code Editor")
        self.setGeometry(100, 100, 1400, 800)
        
        # Веб-движок
        self.browser = QWebEngineView()
        self.setCentralWidget(self.browser)
        
        # Ждем запуска Flask
        QTimer.singleShot(1500, self.load_page)
    
    def load_page(self):
        """Загрузка страницы"""
        print("🌐 Загрузка веб-интерфейса...")
        self.browser.setUrl(QUrl("http://127.0.0.1:7783"))
    
    def closeEvent(self, event):
        """Обработка закрытия окна"""
        reply = QMessageBox.question(
            self,
            'Выход',
            'Вы уверены, что хотите выйти?',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            event.accept()
            # Останавливаем приложение
            os._exit(0)
        else:
            event.ignore()


def check_structure():
    """Проверка структуры проекта"""
    required_dirs = ['templates', 'static/css', 'static/js']
    required_files = [
        'templates/index.html',
        'static/css/style.css',
        'static/js/app.js'
    ]
    
    missing = []
    
    for dir_path in required_dirs:
        if not os.path.exists(dir_path):
            missing.append(f"Папка: {dir_path}")
    
    for file_path in required_files:
        if not os.path.exists(file_path):
            missing.append(f"Файл: {file_path}")
    
    if missing:
        print("=" * 60)
        print("ОШИБКА: Не найдены необходимые файлы!")
        print("=" * 60)
        print("\nОтсутствуют:")
        for item in missing:
            print(f"  ✗ {item}")
        print("\nУбедитесь, что все файлы проекта находятся в правильных папках:")
        print("  - templates/index.html")
        print("  - static/css/style.css")
        print("  - static/js/app.js")
        print("=" * 60)
        input("\nНажмите Enter для выхода...")
        sys.exit(1)


def main():
    """Главная функция"""
    print("=" * 60)
    print("     AI CODE EDITOR - Запуск")
    print("=" * 60)
    
    # Проверка структуры
    check_structure()
    
    # Запуск Flask в отдельном потоке
    flask_thread = threading.Thread(target=run_flask, daemon=True)
    flask_thread.start()
    
    # Небольшая задержка для запуска Flask
    print("⏳ Инициализация...")
    time.sleep(1)
    
    # Запуск PyQt5
    print("🎨 Запуск GUI...")
    qt_app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    
    print("✅ Приложение запущено!")
    print("=" * 60)
    
    sys.exit(qt_app.exec_())


if __name__ == '__main__':
    main()