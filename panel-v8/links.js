/* Данные ресурсной панели. Редактируется вручную или через админку (панель групп → замок).
   Формат (window.RP_LINKS):
   version        — версия формата (сейчас 1)
   sections       — разделы: { id, name, icon }; порядок = порядок вывода
   favoriteSeed   — id ссылок для стартового «Избранного», пока нет кликов
   links          — ссылки, по одной на строку:
     id       — уникальный идентификатор
     section  — id раздела из sections
     title    — название
     url      — адрес http/https (нужен url или tool)
     env      — стенд: PROM | PSI | IFT (необязательно)
     seg      — сегмент сети: ALPHA | SIGMA (необязательно)
     copy     — код, копируется в буфер при клике (необязательно)
     icon     — имя иконки; иначе иконка раздела (необязательно)
     note     — комментарий в подсказке (необязательно)
     meet     — true: встреча Jazz, попадает в полосу «Встречи» (необязательно)
     tool     — decoder | role: встроенный инструмент вместо URL (необязательно)
     check    — false: не проверять доступность (необязательно)
   adminScripts   — реестр будущих скриптов, сейчас пуст */
window.RP_LINKS = {
  "version": 1,
  "sections": [
    {"id":"comms","name":"Коммуникации","icon":"chat"},
    {"id":"heroes","name":"Герои продаж","icon":"trophy"},
    {"id":"kap","name":"КАП и загрузка данных","icon":"upload"},
    {"id":"sup","name":"СУП и релизы","icon":"params"},
    {"id":"access","name":"Доступы, HR, аудит","icon":"lock"},
    {"id":"itsm","name":"Сервис и заявки","icon":"ticket"},
    {"id":"data","name":"Данные и аналитика","icon":"report"},
    {"id":"docs","name":"Документация","icon":"dicts"},
    {"id":"jira","name":"Задачи и команда","icon":"timeline"},
    {"id":"repo","name":"Репозитории","icon":"code"},
    {"id":"tools","name":"Инструменты","icon":"cmd"}
  ],
  "favoriteSeed": ["h-prom-a","h-prom-s","h-psi-a","kap-prom","kap-psi","sand","chat","jazz","daily","mail"],
  "links": [
    {"id":"chat","section":"comms","title":"СберЧат","url":"https://sberchat.sberbank.ru","icon":"chat"},
    {"id":"jazz","section":"comms","title":"SberJazz","url":"https://jazz.sberbank.ru","icon":"video"},
    {"id":"mail","section":"comms","title":"Почта","url":"https://mail.sberbank.ru/owa/#path=/mail","seg":"SIGMA","icon":"mail"},
    {"id":"daily","section":"comms","title":"Дейли · Герои продаж","url":"https://jazz.sberbank.ru/sber-7g5cqu?psw=OBUVBwADHB0IBRIRXxcLDgcPDw","icon":"video","meet":true},
    {"id":"k2","section":"comms","title":"ПКАП встреча (K2)","url":"https://jazz.sberbank.ru/sber-gzdl5c?psw=OEcNEgsBXAZeVwoEVBVLFVFdFw","icon":"video","meet":true},
    {"id":"pereval","section":"comms","title":"ПКАП · Перевала Сергей","url":"https://jazz.sberbank.ru/sber-jd9r1x?psw=OBoIEQsCHAVcCg8HVBYLFlMAEg","icon":"video","meet":true},
    {"id":"open","section":"comms","title":"Встреча (open)","url":"https://jazz.sberbank.ru/sber-mnv6vl?psw=OEEKAUUdDBVeUQ0XGgkbBlFbEA","icon":"video","meet":true},
    {"id":"h-prom-a","section":"heroes","title":"Герои продаж","url":"https://efs-our-business-prom.omega.sbrf.ru/salesheroes","env":"PROM","seg":"ALPHA"},
    {"id":"h-prom-s","section":"heroes","title":"Герои продаж","url":"https://sh.sberbank.ru","env":"PROM","seg":"SIGMA"},
    {"id":"h-psi-a","section":"heroes","title":"Герои продаж","url":"https://iam-enigma-psi.omega.sbrf.ru/salesheroes","env":"PSI","seg":"ALPHA","copy":"92863949"},
    {"id":"h-psi-s","section":"heroes","title":"Герои продаж","url":"https://salesheroes-psi.sigma.sbrf.ru","env":"PSI","seg":"SIGMA"},
    {"id":"h-ift-sb","section":"heroes","title":"Герои продаж СБ","url":"https://efs-ift-sb.delta.sbrf.ru/salesheroes","env":"IFT","seg":"SIGMA"},
    {"id":"h-ift-gf","section":"heroes","title":"Герои продаж ГФ","url":"https://efs-ift-gf.delta.sbrf.ru/salesheroes","env":"IFT","seg":"SIGMA"},
    {"id":"sand","section":"heroes","title":"Песочница","url":"https://bf-enigma-ift.delta.sbrf.ru/","env":"IFT","seg":"SIGMA"},
    {"id":"sand21","section":"heroes","title":"Песочница /21","url":"https://bf-enigma-ift.delta.sbrf.ru/21","env":"IFT","seg":"SIGMA"},
    {"id":"sandp","section":"heroes","title":"Песочница · профиль","url":"https://bf-enigma-ift.delta.sbrf.ru/salesheroes/gamification/profile","env":"IFT","seg":"SIGMA"},
    {"id":"kap-prom","section":"kap","title":"КАП","url":"https://pvlos-sys000001.omega.sbrf.ru/SberDataCorr","env":"PROM","seg":"ALPHA"},
    {"id":"kap-psi","section":"kap","title":"КАП","url":"https://tvlos-sys000001.cloud.omega.sbrf.ru","env":"PSI","seg":"ALPHA","copy":"92863949"},
    {"id":"kap-psi-new","section":"kap","title":"КАП (new)","url":"https://tslos-sys000002.cloud.omega.sbrf.ru/","env":"PSI","seg":"ALPHA","copy":"92863949"},
    {"id":"kap-ift","section":"kap","title":"КАП · data-load","url":"https://tvldw-sys000008.cloud.delta.sbrf.ru:3001/SberDataCorr/PCAP_KKSB_PG_GAME/data-load","env":"IFT","seg":"SIGMA","copy":"92863949"},
    {"id":"ctl","section":"kap","title":"Загрузка данных CTL","url":"https://ctl-ift.qa.df.sbrf.ru:9080/#/sign-in","env":"IFT","seg":"SIGMA","copy":"lakomkin-oo"},
    {"id":"sup-prom-sk","section":"sup","title":"Редактирование СУП · SK","url":"https://iamproxy-prom-gfsk.ingress.apps.arqgec5q.k8s.ca.sbrf.ru","env":"PROM","seg":"ALPHA"},
    {"id":"sup-prom-mg","section":"sup","title":"Редактирование СУП · MG","url":"https://iamproxy-prom-gfmg.ingress.apps.arq6r3xx.k8s.ca.sbrf.ru","env":"PROM","seg":"ALPHA"},
    {"id":"sup-psi-sk","section":"sup","title":"Редактирование СУП · SK","url":"https://iamproxy-psi-gfsk.ingress.apps.a6y9tlz1.k8s.omega.sbrf.ru","env":"PSI","seg":"ALPHA"},
    {"id":"sup-psi-mg","section":"sup","title":"Редактирование СУП · MG","url":"https://iamproxy-psi-gfmg.ingress.apps.a6y5k6kq.k8s.omega.sbrf.ru","env":"PSI","seg":"ALPHA"},
    {"id":"sup-ift-gf","section":"sup","title":"Редактирование СУП · GF","url":"https://iamproxy-ift-gfmg.ingress.apps.a08tr095.k8s.delta.sbrf.ru","env":"IFT","seg":"SIGMA"},
    {"id":"dpm","section":"sup","title":"DPM · подтверждение релизов","url":"https://dpm-sigma.sberbank.ru/dpm/front/main/key/EFS_GAME","env":"PROM"},
    {"id":"sup-arm","section":"sup","title":"Ссылки на АРМы ПСИ · СУП","url":"https://confluence.ca.sbrf.ru/pages/viewpage.action?pageId=1907494673#","env":"PSI","seg":"ALPHA","icon":"dicts"},
    {"id":"sup-doc1","section":"sup","title":"Об управлении СУП пром","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=12034673436","seg":"SIGMA","icon":"dicts"},
    {"id":"sup-doc2","section":"sup","title":"О доступе к управлению СУП пром","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=11862715264","seg":"SIGMA","icon":"dicts"},
    {"id":"addr","section":"access","title":"Адресная книга","url":"https://addressbook.omega.sbrf.ru"},
    {"id":"acc-a","section":"access","title":"Мои доступы","url":"https://smd.omega.sbrf.ru/SberAccess/#/pa?tab=0","seg":"ALPHA"},
    {"id":"acc-s","section":"access","title":"Мои доступы","url":"https://sberu.sigma.sbrf.ru/SberWelcome/#/pa","seg":"SIGMA"},
    {"id":"puls-a","section":"access","title":"Пульс","url":"https://hr.ca.sbrf.ru/platform","seg":"ALPHA"},
    {"id":"puls-s","section":"access","title":"Пульс","url":"https://hr.sberbank.ru/platform/dashboard","seg":"SIGMA"},
    {"id":"friend","section":"access","title":"Друг (new)","url":"https://sberfriend.sberbank.ru/sberfriend/#/dashboard"},
    {"id":"tengri","section":"access","title":"Тенгри","url":"https://ci02587203-psi-iam-proxy-client-geo.omega.sbrf.ru","env":"PSI","seg":"ALPHA"},
    {"id":"tengri-b","section":"access","title":"Тенгри · логи","url":"https://ci02587203-prom-iam-proxy-main-geo.omega.sbrf.ru/indicator-efs-empl/a/logger/logs?","env":"PROM","seg":"ALPHA"},
    {"id":"audit","section":"access","title":"Единый аудит","url":"https://uaudit-psi.omega.sbrf.ru/","env":"PSI","seg":"ALPHA","copy":"92863949"},
    {"id":"audit-n","section":"access","title":"Единый аудит (new)","url":"https://uaudit-psi.omega.sbrf.ru/mind_user/","env":"PSI","seg":"ALPHA","copy":"92863949"},
    {"id":"esm","section":"itsm","title":"SberESM","url":"https://sberesm.omega.sbrf.ru/efs-ermops-static/app-ops_esm","seg":"ALPHA"},
    {"id":"sm-a","section":"itsm","title":"Service Manager","url":"https://servicemanager.omega.sbrf.ru","seg":"ALPHA"},
    {"id":"sm-s","section":"itsm","title":"Service Manager","url":"https://adv-gate.sigma.sbrf.ru/Citrix/ADVWeb","seg":"SIGMA"},
    {"id":"smg-a","section":"itsm","title":"Портал SM · гайд","url":"https://confluence.ca.sbrf.ru/display/ITSM/ITSM+USER+GUIDE","seg":"ALPHA","icon":"dicts"},
    {"id":"smg-s","section":"itsm","title":"Портал SM · гайд","url":"https://sbtatlas.sigma.sbrf.ru/wiki/display/ITSMUG/ITSM+User+Guide","seg":"SIGMA","icon":"dicts"},
    {"id":"help","section":"itsm","title":"SberHelp","url":"https://sberhelp.sberbank.ru","seg":"ALPHA"},
    {"id":"tfs","section":"itsm","title":"ТФС · пакетная выгрузка","url":"https://selfportal.dev.df.sbrf.ru/support/templates/supportfd"},
    {"id":"kaplogs","section":"itsm","title":"Запрос логов КАП-ТФС","url":"https://sberfriend.sberbank.ru/sberfriend/#/application/6BDB0FB3C3604765ABDA49E808B7D0B3","seg":"ALPHA"},
    {"id":"qlik","section":"data","title":"Qlik Sense","url":"https://vpokib.ca.sbrf.ru/main/hub","seg":"ALPHA"},
    {"id":"qs","section":"data","title":"ДБ QS","url":"https://oko-qs.sigma.sbrf.ru","seg":"SIGMA"},
    {"id":"giga","section":"data","title":"ДБ GigaChat","url":"https://oko-qs.sigma.sbrf.ru/prom/sense/app/ea9927f5-64f7-473e-8c3d-c46bd4cea768/sheet/062","seg":"SIGMA"},
    {"id":"nav","section":"data","title":"Навигатор","url":"https://navigator.ca.sbrf.ru/overview","seg":"ALPHA"},
    {"id":"smd","section":"data","title":"Супермаркет данных","url":"https://sm.data.omega.sbrf.ru/home","seg":"ALPHA"},
    {"id":"dtk","section":"data","title":"Дататека","url":"https://datateka.omega.sbrf.ru/desktop","seg":"ALPHA"},
    {"id":"varm","section":"data","title":"VARM LabZone i57z","url":"https://a-lz.omega.sbrf.ru","seg":"ALPHA","copy":"omega\\01803187"},
    {"id":"xls","section":"data","title":"Терминальный xls","url":"https://cab-snp-cx00001.omega.sbrf.ru","seg":"ALPHA","copy":"omega\\01803187"},
    {"id":"hue","section":"data","title":"HUE","url":"http://pklis-mvp003253.labiac.df.sbrf.ru:8888"},
    {"id":"jup","section":"data","title":"JupyterHub","url":"https://pklis-mvp003259.labiac.df.sbrf.ru:8000"},
    {"id":"amb","section":"data","title":"AMBARI","url":"http://pklis-mvp003251.labiac.df.sbrf.ru:8080"},
    {"id":"click","section":"data","title":"Clickstream","url":"https://clickstream-prom.ca.sbrf.ru/frontend","env":"PROM"},
    {"id":"efs","section":"docs","title":"ЕФС","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=9411070842","seg":"SIGMA"},
    {"id":"fab","section":"docs","title":"Фабрика","url":"https://confluence.delta.sbrf.ru/pages/viewpage.action?pageId=9005827798","seg":"SIGMA"},
    {"id":"fab-bl","section":"docs","title":"Бэклог фабрики","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=17521445497","seg":"SIGMA"},
    {"id":"fab-bt","section":"docs","title":"БТ фабрики","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=9528155757","seg":"SIGMA"},
    {"id":"fab-db","section":"docs","title":"Структура БД фабрики","url":"https://confluence.delta.sbrf.ru/pages/viewpage.action?pageId=9005828031","seg":"SIGMA"},
    {"id":"struct","section":"docs","title":"Структура","url":"https://confluence.delta.sbrf.ru/pages/viewpage.action?pageId=9073267075","seg":"SIGMA"},
    {"id":"pkap-db","section":"docs","title":"ПКАП база","url":"https://confluence.delta.sbrf.ru/pages/viewpage.action?pageId=10308059296","seg":"SIGMA"},
    {"id":"tour","section":"docs","title":"Авто-турниры","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=11671348420","seg":"SIGMA"},
    {"id":"testusers","section":"docs","title":"Тестовые пользователи","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=11219247593","env":"IFT","seg":"SIGMA"},
    {"id":"incid","section":"docs","title":"Реестр инцидентов","url":"https://confluence.sberbank.ru/pages/viewpage.action?pageId=24253043818","seg":"SIGMA"},
    {"id":"insider","section":"docs","title":"График периодов инсайдер","url":"https://confluence.ca.sbrf.ru/pages/viewpage.action?pageId=8956707657","seg":"ALPHA"},
    {"id":"sprint","section":"jira","title":"Спринт","url":"https://jira.sberbank.ru/secure/RapidBoard.jspa?rapidView=32210&view=planning.nodetail","seg":"SIGMA"},
    {"id":"sprint-t","section":"jira","title":"Задачи спринта","url":"https://jira.sberbank.ru/secure/StructureBoard.jspa?s=24740#","seg":"SIGMA"},
    {"id":"q2","section":"jira","title":"Задачи 2 кв · HERO-4358","url":"https://jira.sberbank.ru/browse/HERO-4358","seg":"SIGMA"},
    {"id":"q1","section":"jira","title":"Задачи 1 кв","url":"https://jira.sberbank.ru/secure/RapidBoard.jspa?rapidView=32210&view=planning.nodetail","seg":"SIGMA"},
    {"id":"pkap-j","section":"jira","title":"ПКАП · структура","url":"https://jira.delta.sbrf.ru/secure/StructureBoard.jspa?s=19119#","seg":"SIGMA"},
    {"id":"board","section":"jira","title":"Доска команд","url":"https://agile.sber.ru/dashboard/#/","seg":"SIGMA"},
    {"id":"esr","section":"jira","title":"ЕСР","url":"https://esr.sigma.sbrf.ru","seg":"SIGMA"},
    {"id":"devops","section":"jira","title":"DevOps-портал","url":"https://sso.devopsportal.sigma.sbrf.ru/dop/#/","seg":"SIGMA"},
    {"id":"r-and","section":"repo","title":"Мобилка Android","url":"https://stash.delta.sbrf.ru/projects/RMKIB_MOBILE/repos/game_mobile_android/browse","seg":"SIGMA"},
    {"id":"r-ios","section":"repo","title":"Мобилка iOS","url":"https://stash.delta.sbrf.ru/projects/RMKIB_MOBILE/repos/game_mobile_ios/browse","seg":"SIGMA"},
    {"id":"r-front","section":"repo","title":"Фронт ЕФС","url":"https://stash.delta.sbrf.ru/projects/RMKIBPL/repos/gamification/browse","seg":"SIGMA"},
    {"id":"r-back","section":"repo","title":"Бэк ЕФС","url":"https://stash.delta.sbrf.ru/projects/RMKIB/repos/rmkib.gamification/browse","seg":"SIGMA"},
    {"id":"r-sowa","section":"repo","title":"SOWA","url":"https://stash.delta.sbrf.ru/projects/RMKIB/repos/rmkib.sowa.game/browse","seg":"SIGMA"},
    {"id":"r-bps","section":"repo","title":"Фабрика БПС","url":"https://stash.delta.sbrf.ru/projects/KKSBFACT/repos/gamification-bps-service/browse","seg":"SIGMA"},
    {"id":"r-fab","section":"repo","title":"Фабрика · пространство","url":"https://stash.delta.sbrf.ru/projects/KKSBFACT","seg":"SIGMA"},
    {"id":"decoder","section":"tools","title":"Декодер permission","icon":"cmd","tool":"decoder"},
    {"id":"role","section":"tools","title":"Проверка роли (ПСИ)","env":"PSI","icon":"checks","tool":"role"}
  ],
  "adminScripts": []
};
