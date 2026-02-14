// Глобальные переменные
let editor;
let currentFile = null;
let fileModified = false;
let config = {};
let currentCode = '';
let isGenerating = false;
let localFiles = {};        // хранилище файлов выбранных через <input>
let currentDirectory = '';  // текущая открытая директория

// Утилита: выставить язык редактора по имени файла
function setLanguageByFilename(filename) {
    const ext = filename.split('.').pop().toLowerCase();
    const langMap = {
        'py': 'python', 'js': 'javascript', 'ts': 'typescript',
        'html': 'html', 'css': 'css', 'json': 'json',
        'md': 'markdown', 'sh': 'shell', 'sql': 'sql',
        'yml': 'yaml', 'yaml': 'yaml', 'xml': 'xml', 'txt': 'plaintext'
    };
    const lang = langMap[ext] || 'plaintext';
    if (editor) monaco.editor.setModelLanguage(editor.getModel(), lang);
    const sel = document.getElementById('language-select');
    if (sel) sel.value = lang;
}

// Инициализация при загрузке страницы
document.addEventListener('DOMContentLoaded', function() {
    initMonacoEditor();
    loadConfig();
    
    // Горячие клавиши
    document.addEventListener('keydown', function(e) {
        // Ctrl+S - Сохранить
        if (e.ctrlKey && !e.shiftKey && e.key === 's') {
            e.preventDefault();
            saveFile();
        }
        // Ctrl+Shift+S - Сохранить как
        if (e.ctrlKey && e.shiftKey && e.key === 'S') {
            e.preventDefault();
            showSaveAsDialog();
        }
        // F5 - Запустить
        if (e.key === 'F5') {
            e.preventDefault();
            runCode();
        }
        // Ctrl+Enter в чате - отправить
        if (e.ctrlKey && e.key === 'Enter' && document.activeElement.id === 'chat-input') {
            e.preventDefault();
            sendMessage();
        }
        // Escape - закрыть модальные окна
        if (e.key === 'Escape') {
            closeSettings();
            closeCodeAction();
            closeNewFileDialog();
            closeSaveAsDialog();
        }
    });
    
    // Приветственное сообщение
    addChatMessage('system', 'Добро пожаловать в AI Code Editor! Выберите модель и начните работу.');
});

// Инициализация Monaco Editor
function initMonacoEditor() {
    require.config({ paths: { 'vs': 'https://cdnjs.cloudflare.com/ajax/libs/monaco-editor/0.44.0/min/vs' }});
    
    require(['vs/editor/editor.main'], function() {
        editor = monaco.editor.create(document.getElementById('editor-container'), {
            value: '# Добро пожаловать в AI Code Editor!\n# Начните писать код или откройте файл\n\ndef hello_world():\n    print("Hello, World!")\n\nif __name__ == "__main__":\n    hello_world()',
            language: 'python',
            theme: 'vs-dark',
            fontSize: 14,
            minimap: { enabled: true },
            automaticLayout: true,
            scrollBeyondLastLine: false,
            wordWrap: 'on',
            lineNumbers: 'on',
            renderWhitespace: 'selection',
            tabSize: 4,
            insertSpaces: true
        });
        
        // Отслеживание изменений
        editor.onDidChangeModelContent(function() {
            if (!fileModified) {
                fileModified = true;
                updateFileInfo();
            }
        });
    });
}

// Загрузка конфигурации
async function loadConfig() {
    try {
        const response = await fetch('/api/config');
        config = await response.json();
        
        // Заполнение списка моделей
        const modelSelect = document.getElementById('model-select');
        modelSelect.innerHTML = '';
        
        config.models.forEach(model => {
            const option = document.createElement('option');
            option.value = model;
            option.textContent = model;
            if (model === config.selected_model) {
                option.selected = true;
            }
            modelSelect.appendChild(option);
        });
        
        // Загрузка последнего файла
        if (config.last_file) {
            loadFile(config.last_file);
        }
    } catch (error) {
        console.error('Error loading config:', error);
        showNotification('Ошибка загрузки конфигурации', 'error');
    }
}

// Сохранение конфигурации
async function saveConfig() {
    try {
        await fetch('/api/config', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
    } catch (error) {
        console.error('Error saving config:', error);
    }
}

// Обновление информации о файле
function updateFileInfo() {
    const fileInfo = document.getElementById('current-file');
    const modifiedIndicator = document.getElementById('modified-indicator');
    
    if (currentFile) {
        const filename = currentFile.split('/').pop();
        fileInfo.textContent = filename;
    } else {
        fileInfo.textContent = 'Новый файл';
    }
    
    modifiedIndicator.style.display = fileModified ? 'inline' : 'none';
}

// Новый файл
function newFile() {
    if (fileModified) {
        if (!confirm('Есть несохранённые изменения. Продолжить?')) {
            return;
        }
    }
    
    // Спрашиваем имя нового файла сразу
    showNewFileDialog();
}

// Диалог создания нового файла
function showNewFileDialog(parentDir) {
    // Если передана директория — создаём в ней, иначе спрашиваем путь
    const modal = document.getElementById('new-file-modal');
    const dirInput = document.getElementById('new-file-dir');
    
    // Подставляем текущую директорию или директорию открытого файла
    let defaultDir = parentDir || '';
    if (!defaultDir && currentFile) {
        const parts = currentFile.replace(/\\/g, '/').split('/');
        parts.pop();
        defaultDir = parts.join('/');
    }
    dirInput.value = defaultDir;
    document.getElementById('new-file-name').value = 'new_file.py';
    
    modal.classList.add('show');
    setTimeout(() => document.getElementById('new-file-name').select(), 100);
}

// Закрыть диалог нового файла
function closeNewFileDialog() {
    document.getElementById('new-file-modal').classList.remove('show');
}

// Подтвердить создание нового файла
async function confirmNewFile() {
    const name = document.getElementById('new-file-name').value.trim();
    const dir  = document.getElementById('new-file-dir').value.trim();
    
    if (!name) {
        showNotification('Введите имя файла', 'warning');
        return;
    }
    
    if (dir) {
        // Создаём через API если есть директория
        try {
            const resp = await fetch('/api/file/new', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ dirpath: dir, filename: name })
            });
            const data = await resp.json();
            if (data.success) {
                closeNewFileDialog();
                editor.setValue('');
                currentFile = data.path;
                fileModified = false;
                updateFileInfo();
                
                // Автоматически выставляем язык
                setLanguageByFilename(name);
                
                showNotification('Файл создан: ' + name, 'success');
                refreshFileTree();
            } else {
                showNotification('Ошибка: ' + data.error, 'error');
            }
        } catch (e) {
            showNotification('Ошибка создания: ' + e.message, 'error');
        }
    } else {
        // Без директории — просто создаём буфер с именем (сохраним через Save As)
        closeNewFileDialog();
        editor.setValue('');
        currentFile = name;   // временно — только имя, без пути
        fileModified = false;
        updateFileInfo();
        setLanguageByFilename(name);
        showNotification('Введите путь при сохранении (Ctrl+Shift+S)', 'info');
    }
}

// Диалог открытия файла
function openFileDialog() {
    document.getElementById('file-picker').click();
}

// Обработка выбора файла
async function handleFileSelect(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    try {
        const text = await file.text();
        editor.setValue(text);
        
        // Сохраняем объект файла для возможного запуска через сервер
        localFiles[file.name] = file;
        currentFile = file.name;
        fileModified = false;
        updateFileInfo();
        setLanguageByFilename(file.name);
        
        showNotification('Файл открыт: ' + file.name, 'success');
    } catch (error) {
        showNotification('Ошибка открытия файла: ' + error.message, 'error');
    }
    
    // Сбрасываем input
    event.target.value = '';
}

// Загрузка файла
async function loadFile(filepath) {
    try {
        const response = await fetch('/api/file/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: filepath })
        });
        
        const data = await response.json();
        
        if (data.success) {
            editor.setValue(data.content);
            currentFile = data.path;
            fileModified = false;
            updateFileInfo();
            showNotification('Файл загружен: ' + data.filename, 'success');
        } else {
            showNotification('Ошибка: ' + data.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка загрузки файла: ' + error.message, 'error');
    }
}

// Сохранение файла (Ctrl+S)
async function saveFile() {
    if (!currentFile) {
        // Нет текущего файла — показываем диалог нового файла
        showNewFileDialog();
        return;
    }
    
    // Проверяем: это реальный путь (содержит разделитель) или просто имя?
    const isRealPath = currentFile.includes('/') || currentFile.includes('\\');
    
    if (!isRealPath) {
        // Только имя файла — показываем Save As диалог
        showSaveAsDialog();
        return;
    }
    
    await doSaveFile(currentFile);
}

// Save As диалог
function showSaveAsDialog() {
    const modal = document.getElementById('save-as-modal');
    document.getElementById('save-as-path').value = currentFile || '';
    modal.classList.add('show');
    setTimeout(() => document.getElementById('save-as-path').select(), 100);
}

function closeSaveAsDialog() {
    document.getElementById('save-as-modal').classList.remove('show');
}

async function confirmSaveAs() {
    const path = document.getElementById('save-as-path').value.trim();
    if (!path) {
        showNotification('Введите путь для сохранения', 'warning');
        return;
    }
    closeSaveAsDialog();
    await doSaveFile(path);
}

// Фактическое сохранение файла
async function doSaveFile(filepath) {
    try {
        const response = await fetch('/api/file/save', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                path: filepath,
                content: editor.getValue()
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            currentFile = filepath;
            fileModified = false;
            updateFileInfo();
            showNotification(data.message, 'success');
            refreshFileTree();
        } else {
            showNotification('Ошибка: ' + data.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка сохранения: ' + error.message, 'error');
    }
}

// Запуск кода
async function runCode() {
    const code = editor.getValue().trim();
    if (!code) {
        showNotification('Редактор пуст', 'warning');
        return;
    }
    
    // Если файл не сохранён в реальном пути — сохраняем во временный
    const isRealPath = currentFile && (currentFile.includes('/') || currentFile.includes('\\'));
    
    if (isRealPath && fileModified) {
        await doSaveFile(currentFile);
    }
    
    let runPath = currentFile;
    
    if (!isRealPath) {
        // Сохраняем во временный файл
        const tmpName = (currentFile || 'temp_script.py').replace(/[/\\:*?"<>|]/g, '_');
        showNotification('Сохраняем во временный файл для запуска...', 'info');
        
        try {
            const saveResp = await fetch('/api/file/save_temp', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ filename: tmpName, content: code })
            });
            const saveData = await saveResp.json();
            if (!saveData.success) {
                showNotification('Ошибка сохранения временного файла', 'error');
                return;
            }
            runPath = saveData.path;
        } catch (e) {
            showNotification('Ошибка: ' + e.message, 'error');
            return;
        }
    }
    
    try {
        const response = await fetch('/api/code/run', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: runPath })
        });
        
        const data = await response.json();
        
        if (data.success) {
            showNotification('▶ ' + data.message, 'success');
        } else {
            showNotification('Ошибка запуска: ' + data.error, 'error');
        }
    } catch (error) {
        showNotification('Ошибка запуска: ' + error.message, 'error');
    }
}

// Смена языка
function changeLanguage() {
    const lang = document.getElementById('language-select').value;
    monaco.editor.setModelLanguage(editor.getModel(), lang);
}

// Смена темы
function toggleTheme() {
    const currentTheme = editor._themeService._theme.themeName;
    const newTheme = currentTheme === 'vs-dark' ? 'vs-light' : 'vs-dark';
    monaco.editor.setTheme(newTheme);
}

// Диалог выбора директории
function openDirectoryDialog() {
    document.getElementById('directory-picker').click();
}

// Обновление дерева файлов
async function refreshFileTree() {
    if (!currentDirectory) return;
    
    try {
        const resp = await fetch('/api/file/list', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: currentDirectory })
        });
        const data = await resp.json();
        
        if (data.items) {
            renderFileTree(data.items, currentDirectory);
        }
    } catch (e) {
        showNotification('Ошибка обновления дерева файлов', 'error');
    }
}

// Обработка выбора директории
async function handleDirectorySelect(event) {
    const files = Array.from(event.target.files);
    if (!files.length) return;
    
    // Получаем корневой путь директории из первого файла
    // webkitRelativePath = "folder/subfolder/file.ext"
    const firstPath = files[0].webkitRelativePath;
    const rootFolderName = firstPath.split('/')[0];
    
    // Сохраняем файлы локально для быстрого доступа
    localFiles = {};
    files.forEach(f => {
        localFiles[f.webkitRelativePath] = f;
    });
    
    // Строим дерево из путей
    const tree = buildTreeFromPaths(files.map(f => f.webkitRelativePath));
    renderLocalFileTree(tree, rootFolderName);
    
    // Пробуем также открыть через API если Flask знает этот путь
    // (это работает когда приложение запущено локально)
    try {
        const resp = await fetch('/api/directory/open', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: '.' }) // fallback
        });
    } catch(e) {}
    
    showNotification(`Открыта папка: ${rootFolderName} (${files.length} файлов)`, 'success');
    
    // Сбрасываем input чтобы можно было переоткрыть ту же папку
    event.target.value = '';
}

// Построение дерева из массива путей
function buildTreeFromPaths(paths) {
    const root = {};
    paths.forEach(path => {
        const parts = path.split('/');
        let node = root;
        parts.forEach((part, i) => {
            if (!node[part]) {
                node[part] = i === parts.length - 1 ? null : {};
            }
            if (node[part] !== null) node = node[part];
        });
    });
    return root;
}

// Рендер локального дерева файлов (из браузерного <input>)
function renderLocalFileTree(tree, rootName) {
    currentDirectory = rootName;
    const container = document.getElementById('file-tree');
    container.innerHTML = '';
    
    // Заголовок с именем папки
    const header = document.createElement('div');
    header.className = 'tree-root-label';
    header.innerHTML = `<i class="fas fa-folder-open" style="color:var(--accent-yellow)"></i> <strong>${rootName}</strong>`;
    container.appendChild(header);
    
    renderTreeNode(tree[rootName] || tree, container, rootName + '/');
}

// Рекурсивный рендер узла дерева
function renderTreeNode(node, container, pathPrefix) {
    if (!node) return;
    
    const entries = Object.entries(node).sort(([a, av], [b, bv]) => {
        // Папки первыми
        if (av !== null && bv === null) return -1;
        if (av === null && bv !== null) return 1;
        return a.localeCompare(b);
    });
    
    entries.forEach(([name, children]) => {
        const fullRelPath = pathPrefix + name;
        const isDir = children !== null;
        
        const item = document.createElement('div');
        item.className = 'file-item' + (isDir ? ' folder' : '');
        item.style.paddingLeft = (pathPrefix.split('/').length * 8) + 'px';
        
        const ext = name.split('.').pop().toLowerCase();
        const icon = isDir ? 'fa-folder' : getFileIcon(ext);
        const iconColor = isDir ? 'color:var(--accent-yellow)' : getFileIconColor(ext);
        
        item.innerHTML = `<i class="fas ${icon}" style="${iconColor}"></i> ${name}`;
        
        if (!isDir) {
            item.onclick = () => openLocalFile(fullRelPath, name);
            
            // Контекстное меню
            item.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                showContextMenu(e, { path: fullRelPath, name, isDir: false, isLocal: true });
            });
        } else {
            // Папка — toggle раскрытие
            const childContainer = document.createElement('div');
            childContainer.className = 'file-children';
            childContainer.style.display = 'none';
            let expanded = false;
            
            item.onclick = () => {
                expanded = !expanded;
                childContainer.style.display = expanded ? 'block' : 'none';
                item.querySelector('i').className = `fas ${expanded ? 'fa-folder-open' : 'fa-folder'}`;
            };
            
            container.appendChild(item);
            renderTreeNode(children, childContainer, fullRelPath + '/');
            container.appendChild(childContainer);
            return;
        }
        
        container.appendChild(item);
    });
}

// Открытие локального файла (из браузерного input)
async function openLocalFile(relPath, name) {
    const file = localFiles[relPath];
    if (!file) {
        showNotification('Файл не найден в буфере', 'error');
        return;
    }
    
    try {
        const text = await file.text();
        editor.setValue(text);
        currentFile = relPath;  // относительный путь
        fileModified = false;
        updateFileInfo();
        setLanguageByFilename(name);
        
        // Подсветить активный файл
        document.querySelectorAll('.file-item.active').forEach(el => el.classList.remove('active'));
        event.target.closest('.file-item')?.classList.add('active');
        
    } catch (e) {
        showNotification('Ошибка чтения файла: ' + e.message, 'error');
    }
}

// Иконка по расширению
function getFileIcon(ext) {
    const map = {
        py: 'fa-brands fa-python', js: 'fa-brands fa-js',
        ts: 'fa-file-code', html: 'fa-brands fa-html5',
        css: 'fa-brands fa-css3-alt', json: 'fa-file-code',
        md: 'fa-file-alt', txt: 'fa-file-alt', sh: 'fa-terminal',
        sql: 'fa-database', yml: 'fa-file-code', yaml: 'fa-file-code',
        png: 'fa-image', jpg: 'fa-image', svg: 'fa-image',
        pdf: 'fa-file-pdf', zip: 'fa-file-archive',
    };
    return map[ext] || 'fa-file';
}

// Цвет иконки по расширению
function getFileIconColor(ext) {
    const map = {
        py: 'color:#3b82f6', js: 'color:#f59e0b', ts: 'color:#3b82f6',
        html: 'color:#ef4444', css: 'color:#8b5cf6', json: 'color:#10b981',
        md: 'color:#cbd5e1', sh: 'color:#10b981', sql: 'color:#f59e0b',
    };
    return map[ext] || 'color:var(--text-secondary)';
}

// Контекстное меню для файлового дерева
function showContextMenu(e, fileInfo) {
    document.querySelectorAll('.context-menu').forEach(m => m.remove());
    
    const menu = document.createElement('div');
    menu.className = 'context-menu';
    menu.style.cssText = `
        position:fixed; top:${e.clientY}px; left:${e.clientX}px;
        background:var(--bg-secondary); border:1px solid var(--border-color);
        border-radius:6px; padding:4px; z-index:9999; min-width:160px;
        box-shadow:0 8px 24px var(--shadow);
    `;
    
    const items = [
        { icon: 'fa-folder-plus', label: 'Создать файл', action: () => showNewFileDialog(getParentDir(fileInfo.path)) },
        { icon: 'fa-copy', label: 'Копировать имя', action: () => navigator.clipboard.writeText(fileInfo.name) },
        { separator: true },
        { icon: 'fa-trash', label: 'Удалить', action: () => deleteFileFromTree(fileInfo), danger: true },
        { icon: 'fa-pen', label: 'Переименовать', action: () => renameFileInTree(fileInfo) },
    ];
    
    items.forEach(item => {
        if (item.separator) {
            const sep = document.createElement('div');
            sep.style.cssText = 'border-top:1px solid var(--border-color); margin:4px 0;';
            menu.appendChild(sep);
            return;
        }
        const btn = document.createElement('button');
        btn.style.cssText = `
            display:flex; align-items:center; gap:8px; width:100%; padding:7px 12px;
            background:none; border:none; color:${item.danger ? 'var(--accent-red)' : 'var(--text-primary)'};
            cursor:pointer; font-size:13px; border-radius:4px; text-align:left;
        `;
        btn.innerHTML = `<i class="fas ${item.icon}"></i> ${item.label}`;
        btn.onmouseenter = () => btn.style.background = 'var(--bg-hover)';
        btn.onmouseleave = () => btn.style.background = 'none';
        btn.onclick = () => { item.action(); menu.remove(); };
        menu.appendChild(btn);
    });
    
    document.body.appendChild(menu);
    
    // Закрыть при клике вне меню
    setTimeout(() => {
        document.addEventListener('click', () => menu.remove(), { once: true });
    }, 10);
}

function getParentDir(filePath) {
    const parts = filePath.replace(/\\/g, '/').split('/');
    parts.pop();
    return parts.join('/');
}

async function deleteFileFromTree(fileInfo) {
    if (!confirm(`Удалить "${fileInfo.name}"?`)) return;
    // Для локальных файлов просто удаляем из дерева
    if (fileInfo.isLocal) {
        delete localFiles[fileInfo.path];
        showNotification(`Удалено из буфера: ${fileInfo.name}`, 'success');
        // Перестраиваем дерево
        const tree = buildTreeFromPaths(Object.keys(localFiles));
        const rootName = Object.keys(localFiles)[0]?.split('/')[0] || currentDirectory;
        renderLocalFileTree(tree, rootName);
        return;
    }
    try {
        const resp = await fetch('/api/file/delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: fileInfo.path })
        });
        const data = await resp.json();
        if (data.success) {
            showNotification('Удалено: ' + fileInfo.name, 'success');
            refreshFileTree();
        }
    } catch(e) {}
}

async function renameFileInTree(fileInfo) {
    const newName = prompt('Новое имя:', fileInfo.name);
    if (!newName || newName === fileInfo.name) return;
    
    if (fileInfo.isLocal) {
        showNotification('Переименование доступно только для файлов на сервере', 'info');
        return;
    }
    try {
        const resp = await fetch('/api/file/rename', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ old_path: fileInfo.path, new_name: newName })
        });
        const data = await resp.json();
        if (data.success) {
            showNotification('Переименовано', 'success');
            refreshFileTree();
        }
    } catch(e) {}
}

// === AI CHAT ===

// Добавление сообщения в чат
function addChatMessage(role, message) {
    const chatContainer = document.getElementById('chat-messages');
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${role}`;
    
    const iconMap = {
        'user': 'fa-user',
        'ai': 'fa-robot',
        'error': 'fa-exclamation-triangle',
        'system': 'fa-info-circle'
    };
    
    const labelMap = {
        'user': 'Вы',
        'ai': 'AI',
        'error': 'Ошибка',
        'system': 'Система'
    };
    
    const header = document.createElement('div');
    header.className = 'chat-message-header';
    header.innerHTML = `<i class="fas ${iconMap[role]}"></i> ${labelMap[role]}`;
    
    const content = document.createElement('div');
    content.className = 'chat-message-content';
    
    // Парсинг Markdown для AI ответов
    if (role === 'ai') {
        content.innerHTML = parseMarkdown(message);
    } else {
        content.textContent = message;
    }
    
    messageDiv.appendChild(header);
    messageDiv.appendChild(content);
    chatContainer.appendChild(messageDiv);
    
    // Прокрутка вниз
    chatContainer.scrollTop = chatContainer.scrollHeight;
}

// Простой парсинг Markdown
function parseMarkdown(text) {
    // Блоки кода
    text = text.replace(/```(\w+)?\n([\s\S]*?)```/g, function(match, lang, code) {
        return `<pre><code>${escapeHtml(code.trim())}</code></pre>`;
    });
    
    // Inline код
    text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
    
    // Жирный текст
    text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    
    // Курсив
    text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
    
    // Переводы строк
    text = text.replace(/\n/g, '<br>');
    
    return text;
}

// Экранирование HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Быстрая команда
function quickCommand(command) {
    const code = editor.getValue().trim();
    if (!code) {
        showNotification('Сначала напишите или откройте код', 'warning');
        return;
    }
    
    document.getElementById('chat-input').value = command;
    sendMessage();
}

// Отправка сообщения
async function sendMessage() {
    if (isGenerating) {
        showNotification('Дождитесь завершения предыдущего запроса', 'warning');
        return;
    }
    
    const input = document.getElementById('chat-input');
    const message = input.value.trim();
    
    if (!message) return;
    
    const model = document.getElementById('model-select').value;
    if (!model) {
        showNotification('Выберите модель AI', 'warning');
        openSettings();
        return;
    }
    
    // Очистка поля ввода
    input.value = '';
    
    // Добавление сообщения пользователя
    addChatMessage('user', message);
    
    // Показ индикатора загрузки
    const loadingIndicator = document.getElementById('loading-indicator');
    loadingIndicator.style.display = 'block';
    isGenerating = true;
    
    // Получение кода
    const code = editor.getValue().trim();
    
    try {
        const response = await fetch('/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                message: message,
                code: code,
                model: model
            })
        });
        
        const data = await response.json();
        
        if (data.success) {
            parseAIResponse(data.response, message);
        } else {
            addChatMessage('error', data.error || 'Произошла ошибка');
        }
    } catch (error) {
        addChatMessage('error', 'Ошибка соединения: ' + error.message);
    } finally {
        loadingIndicator.style.display = 'none';
        isGenerating = false;
    }
}

// Парсинг ответа AI
function parseAIResponse(response, originalRequest) {
    // Проверка на наличие кода
    const hasCodeBlocks = response.includes('```');
    
    if (hasCodeBlocks) {
        // Извлечение блоков кода
        const codeBlocks = [];
        const textParts = [];
        
        const parts = response.split('```');
        for (let i = 0; i < parts.length; i++) {
            if (i % 2 === 1) { // Блок кода
                let code = parts[i];
                // Удаляем язык если указан
                if (code.startsWith('python\n')) {
                    code = code.substring(7);
                } else if (code.startsWith('py\n')) {
                    code = code.substring(3);
                } else if (code.includes('\n')) {
                    const lines = code.split('\n');
                    if (lines.length > 1) {
                        code = lines.slice(1).join('\n');
                    }
                }
                codeBlocks.push(code.trim());
            } else if (parts[i].trim()) { // Текст
                textParts.push(parts[i].trim());
            }
        }
        
        if (codeBlocks.length > 0) {
            const codeToInsert = codeBlocks.join('\n\n');
            
            // Показываем текст
            if (textParts.length > 0) {
                addChatMessage('ai', textParts.join('\n'));
            } else {
                addChatMessage('ai', 'Код готов для использования.');
            }
            
            // Показываем диалог с кодом
            showCodeActionDialog(codeToInsert);
        } else {
            addChatMessage('ai', response);
        }
    } else {
        // Проверяем, может это код без markdown
        const isCodeRequest = ['код', 'code', 'функци', 'класс', 'напиши', 'создай', 'сделай']
            .some(word => originalRequest.toLowerCase().includes(word));
        
        const looksLikeCode = ['def ', 'class ', 'import ', 'from ', 'if __name__']
            .some(keyword => response.includes(keyword));
        
        if (isCodeRequest && looksLikeCode) {
            showCodeActionDialog(response.trim());
        } else {
            addChatMessage('ai', response);
        }
    }
}

// Показать диалог действия с кодом
function showCodeActionDialog(code) {
    currentCode = code;
    
    const modal = document.getElementById('code-action-modal');
    const preview = document.getElementById('code-preview');
    
    preview.textContent = code;
    modal.classList.add('show');
}

// Закрыть диалог действия с кодом
function closeCodeAction() {
    const modal = document.getElementById('code-action-modal');
    modal.classList.remove('show');
    currentCode = '';
}

// Действие с кодом
function codeAction(action) {
    if (!currentCode) return;
    
    switch (action) {
        case 'replace':
            editor.setValue(currentCode);
            fileModified = true;
            updateFileInfo();
            addChatMessage('system', '✓ Код заменён в редакторе');
            break;
            
        case 'insert':
            const position = editor.getPosition();
            editor.executeEdits('', [{
                range: new monaco.Range(position.lineNumber, position.column, position.lineNumber, position.column),
                text: '\n' + currentCode + '\n'
            }]);
            fileModified = true;
            updateFileInfo();
            addChatMessage('system', '✓ Код вставлен в позицию курсора');
            break;
            
        case 'copy':
            navigator.clipboard.writeText(currentCode);
            addChatMessage('system', '✓ Код скопирован в буфер обмена');
            break;
            
        case 'cancel':
            addChatMessage('system', '✗ Действие отменено');
            break;
    }
    
    closeCodeAction();
}

// Очистка чата
function clearChat() {
    const chatContainer = document.getElementById('chat-messages');
    chatContainer.innerHTML = '';
    addChatMessage('system', 'Чат очищен');
}

// === НАСТРОЙКИ ===

// Открыть настройки
function openSettings() {
    const modal = document.getElementById('settings-modal');
    
    document.getElementById('api-key-input').value = config.api_key || '';
    document.getElementById('models-input').value = config.models.join('\n');
    
    modal.classList.add('show');
}

// Закрыть настройки
function closeSettings() {
    const modal = document.getElementById('settings-modal');
    modal.classList.remove('show');
}

// Сохранить настройки
async function saveSettings() {
    const apiKey = document.getElementById('api-key-input').value.trim();
    const modelsText = document.getElementById('models-input').value;
    const models = modelsText.split('\n').map(m => m.trim()).filter(m => m);
    
    config.api_key = apiKey;
    config.models = models;
    config.selected_model = models[0] || '';
    
    await saveConfig();
    await loadConfig();
    
    showNotification('Настройки сохранены', 'success');
    closeSettings();
}

// === УВЕДОМЛЕНИЯ ===

// Добавьте эту функцию для красивых уведомлений
function showNotification(message, type = 'info') {
    // Создаем элемент уведомления
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.innerHTML = `
        <i class="fas ${type === 'success' ? 'fa-check-circle' : 
                         type === 'error' ? 'fa-exclamation-circle' : 
                         type === 'warning' ? 'fa-exclamation-triangle' : 'fa-info-circle'}"></i>
        <span>${message}</span>
    `;
    
    // Добавляем стили для уведомления
    const style = document.createElement('style');
    style.textContent = `
        .notification {
            position: fixed;
            top: 60px;
            right: 20px;
            padding: 12px 20px;
            background: var(--bg-secondary);
            border-left: 4px solid var(--accent-blue);
            border-radius: 4px;
            box-shadow: 0 4px 12px var(--shadow);
            display: flex;
            align-items: center;
            gap: 10px;
            z-index: 2000;
            animation: notificationSlide 0.3s ease-out, notificationFade 0.3s ease-out 2.7s forwards;
            backdrop-filter: blur(10px);
        }
        
        .notification-success {
            border-left-color: var(--accent-green);
        }
        
        .notification-error {
            border-left-color: var(--accent-red);
        }
        
        .notification-warning {
            border-left-color: var(--accent-yellow);
        }
        
        @keyframes notificationSlide {
            from {
                transform: translateX(100%);
                opacity: 0;
            }
            to {
                transform: translateX(0);
                opacity: 1;
            }
        }
        
        @keyframes notificationFade {
            to {
                transform: translateX(100%);
                opacity: 0;
            }
        }
    `;
    
    document.head.appendChild(style);
    document.body.appendChild(notification);
    
    // Удаляем через 3 секунды
    setTimeout(() => {
        notification.remove();
    }, 3000);
}

// Замените существующую функцию showNotification на эту