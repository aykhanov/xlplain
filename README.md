# XLPlain — GitHub Pages

Готовый статический сайт для публикации по адресу:

https://aykhanov.github.io/xlplain/

## Как опубликовать

1. Войдите в GitHub под аккаунтом `aykhanov`.
2. Создайте новый публичный репозиторий с точным именем `xlplain`.
3. Загрузите в корень репозитория файлы:
   - `index.html`
   - `offer.html`
   - `privacy.html`
   - `styles.css`
4. Откройте:
   `Settings` → `Pages`.
5. В блоке `Build and deployment`:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/ (root)`
6. Нажмите `Save`.
7. Через несколько минут откройте:
   https://aykhanov.github.io/xlplain/

## Важно перед подачей сайта в Robokassa

Сайт уже содержит:
- описание XLPlain;
- цену;
- порядок получения цифрового продукта;
- условия активации;
- возврат;
- контакты;
- данные самозанятого;
- публичную оферту;
- политику обработки персональных данных.

Кнопка «Купить XLPlain» сейчас открывает письмо на XLPlain@yandex.com.
После активации магазина Robokassa эту ссылку нужно заменить на платежную ссылку/кнопку Robokassa.

## Где менять ссылку оплаты

В `index.html` найдите:

href="mailto:XLPlain@yandex.com?subject=..."

и замените значение `href` на платежную ссылку Robokassa.

Других изменений для подключения кнопки оплаты не требуется.
