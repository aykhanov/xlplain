# XLPlain — GitHub Pages

Сайт XLPlain опубликован по адресу:

https://aykhanov.github.io/xlplain/

## Состав сайта

В корне репозитория используются:
- `index.html` — главная страница и блок покупки;
- `offer.html` — публичная оферта;
- `privacy.html` — политика обработки персональных данных;
- `success.html` — страница успешной оплаты;
- `fail.html` — страница неуспешной оплаты;
- `styles.css` — стили сайта.

## Платёжная схема

Форма покупки отправляет POST-запрос на Yandex Cloud Function:

`https://functions.yandexcloud.net/d4eqf3vcn7fdkg0f5td4`

Поля формы:
- `action=create_payment`;
- `email=<email покупателя>`.

Сервер формирует платёж Robokassa и перенаправляет покупателя на страницу оплаты.

## Безопасное состояние до запуска продаж

На сервере должно оставаться:

`ROBOKASSA_LIVE_ENABLED=0`

Пока магазин Robokassa не активирован, кнопка `Оплатить 2 990 ₽` на сайте также оставлена с атрибутом `disabled`.

После активации магазина:
1. проверить рабочие Password #1 / Password #2;
2. настроить в Robokassa:
   - Result URL: `https://functions.yandexcloud.net/d4eqf3vcn7fdkg0f5td4`, метод POST;
   - Success URL: `https://aykhanov.github.io/xlplain/success.html`, метод GET;
   - Fail URL: `https://aykhanov.github.io/xlplain/fail.html`, метод GET;
3. установить `ROBOKASSA_LIVE_ENABLED=1`;
4. удалить `disabled` у кнопки оплаты в `index.html`;
5. провести один контрольный боевой платёж.

## Фискализация

Используется решение Robokassa «Робочеки СМЗ».

Позиция чека:

`Право использования программы XLPlain (надстройка для Microsoft Excel)`

Цена: 2 990 ₽.
