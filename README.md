# Repo Feed

Публичные репозитории GitHub в ленте со свайпами. Автор проекта — **vladstalker2027-stack**.

[Открыть сайт](https://applememestm-pixel.github.io/repofeed/) · [Скачать APK и расширение](https://github.com/applememestm-pixel/repofeed/releases/latest)

- **Обзор** показывает карточки по теме. Попробуй `machine-learning`, `rust` или `web`.
- **Для вас** подбирает проекты по темам из сохранённых карточек.
- **Каталог** показывает результаты списком с пагинацией.
- **Сохранённые** и **История** хранятся в текущем браузере или приложении.

Нажми на название, чтобы открыть репозиторий. Свайп влево пропускает карточку, свайп вправо сохраняет. «Краткая сводка» загружает README. Если в браузере доступна локальная модель Summarizer, она составляет сводку. В остальных случаях кнопка показывает выдержку из README.

## На компьютере

Открой сайт или запусти `python -m http.server 5500` в корне проекта и перейди на `http://localhost:5500`.

Для Chrome, Edge и других браузеров на Chromium распакуй `repofeed-chromium.zip`. На странице расширений включи режим разработчика и нажми «Загрузить распакованное расширение». Выбери папку с `manifest.json` и обнови github.com. Кнопка Repo Feed появится в шапке или справа внизу, если браузер не найдёт шапку. Нажатие открывает ленту поверх GitHub.

## Android

Скачай `repofeed-android.apk` из Releases. Приложение поддерживает Android 8 и новее. APK подписан для прямой установки. Вход и загрузка репозиториев требуют интернета.

## Авторизация GitHub

Лента публичных проектов доступна сразу. Для увеличения лимита можно подключить собственный GitHub-токен с доступом к публичным репозиториям через кнопку **GitHub**. Токен используется только в текущей сессии приложения и передаётся только на GitHub API. «Выйти» очищает его.

Расширение и APK поддерживают [GitHub Device Flow](https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/authorizing-oauth-apps#device-flow). Кнопка штатного входа появляется, когда в `config.js` задан публичный Client ID OAuth-приложения с включённым Device Flow. При входе GitHub показывает подтверждение. Приложение не запрашивает доступ к приватным репозиториям.

## Сборка

Для расширения нужны Python 3 и команда `python scripts/build-extension.py`. Архив появится в `dist/`.

Для Android нужны JDK, Python 3, Android Platform 35 и Build Tools 35. Передай путь к `android.jar` через `--platform` и к каталогу Build Tools через `--tools`:

```sh
python scripts/build-android.py --platform "$ANDROID_HOME/platforms/android-35/android.jar" --tools "$ANDROID_HOME/build-tools/35.0.0"
```

Результат появится в `dist/`. Для обновления APK сохраняй локальный ключ из `.build/`. GitHub Actions собирает пакеты для проверки. Для установки и обновлений используй APK из Releases.

[Лицензия MIT](LICENSE)
