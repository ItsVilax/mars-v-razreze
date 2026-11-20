Задача 9. Подготовленные данные и их происхождение
Снимок источников: 18 ноября 2026 года.

1. craters20.csv

Это все строки с diameter >= 20 из таблицы mars_craters.epn_core сервиса Paris Astronomical Data Centre — Constructor University. Основа — каталог Robbins & Hynek (2012), DOI 10.1029/2011JE003966. Это зафиксированная копия сервиса PADC, а не файл выпуска 2020 с сайта автора. Сервис прямо сообщает об исключении бассейна Prometheus по технической причине. Отсутствующие в каталоге кратеры нельзя считать отсутствующими в природе.

Поля:
crater_id — идентификатор (исходный granule_uid); считайте текстом;
lat_n_deg — широта центра, градусы, север положителен (c2min);
lon_e_deg — восточная долгота центра 0–360°, градусы (c1min);
diameter_km — диаметр, км (diameter);
name — название, если есть (feature_name); пустое название не мешает счёту.

В файле один кратер занимает одну строку. Диаметры и широты не округлялись сверх точности исходной таблицы; долгота представлена с тремя десятичными знаками (точность исходного каталога). Строки упорядочены по crater_id. Фильтр diameter >= 20 был применён до выдачи команде. Север: lat_n_deg >= 0; юг: lat_n_deg < 0. Для сравнения полушарий используйте всю площадь каждого полушария, 2*pi*R^2, R=3389.5 км. Для карты ячеек считайте площадь каждой ячейки отдельно.

Доступ к исходной таблице:
http://voparis-tap-planeto.obspm.fr/tableinfo/mars_craters.epn_core
TAP endpoint: http://voparis-tap-planeto.obspm.fr/tap
Запрос:
SELECT granule_uid,c1min,c2min,diameter,feature_name
FROM mars_craters.epn_core WHERE diameter >= 20
Параметры: REQUEST=doQuery, LANG=ADQL, FORMAT=csv, MAXREC=50000.
Исходная выгрузка padc_craters_ge20.csv: SHA-256 3aa46aabb46453a9c915c98c565675f9c052c4f891c6d7d13861299766d7dd32.

Цитирование: Robbins, S. J., & Hynek, B. M. (2012). A New Global Database of Mars Impact Craters >=1 km: 1. Database Creation, Properties, and Parameters. JGR Planets, 117, E05004. https://doi.org/10.1029/2011JE003966. Доступ через Minin, M., Mars Craters, PADC TAP Server. Отдельная лицензия на этой странице и в VO-метаданных не указана; не приписывайте файлу лицензию CC-BY.

2. shore_A.csv и shore_B.csv

Два удалённых фрагмента одной опубликованной версии Deuteronilus, Ivanov et al. (2017), из архива Sholes et al. (2021), Zenodo v2.0.1:
https://zenodo.org/records/4666803
https://zenodo.org/records/4666803/files/Sholes2021_Data.zip
MD5 архива: 874ab38d28f9380369d6461b3cb8d42d.
Лицензия архива: Creative Commons Attribution 4.0 International (CC BY 4.0), https://creativecommons.org/licenses/by/4.0/ .

Источник координат и последовательности: Sholes2021_ArcMapLayers.lpk, внутри commondata/deuteronilus/Ivanov2017_Deuteronilus_Original_VPZ_shift.shp. Поля ID и RASTERVALU и координаты геометрии точки сохранены. Это опубликованная геометрия Mars_2000_Sphere; восточные долготы и северные широты в градусах.
Источник независимой сверки высот: Elevation Data/Deuteronilus/0_Ivanov2017_Deuteronilus_Original_Topo.csv, столбец Elevation_m. RASTERVALU совпадает с ним во всех 18611 строках. По README авторов эти высоты взяты из объединённой модели HRSC/MOLA, 200 м/пиксель. Это не результат выборки из грубой сетки MOLA 4 пикселя/градус.

Поля подготовленных CSV:
point — порядок точки внутри подготовленного фрагмента;
source_FID — FID строки в исходном CSV; нумерация с нуля;
source_ID — ID точки в shapefile; задаёт последовательность по фрагменту;
region — название региона источника;
lon_e_deg, lat_n_deg — координаты геометрии опубликованного shapefile;
distance_km — накопленная длина ломаной от первой точки, км;
height_m — опубликованная высота RASTERVALU / Elevation_m, м.

A: Region Deuteronilus 1, ID 5617–5656 включительно.
B: Region Astapus 1, ID 8060–8100 включительно.
Порядок: возрастание source_ID. Не сортируйте точки по FID, высоте или долготе. Разные фрагменты не соединяются в один профиль. Медиану считайте по всем строкам соответствующего файла с одинаковым весом каждой точки; этот результат относится к данным точкам, а не к равномерно измеренному полному берегу.

Расстояние между соседними точками рассчитано по формуле гаверсинуса на сфере R=3389.5 км, затем суммировано. Углы в формуле — радианы:
a=sin²((lat2-lat1)/2)+cos(lat1)*cos(lat2)*sin²((lon2-lon1)/2)
d=2*R*asin(sqrt(a)).

Преобразования: выбран интервал исходных ID, восточная долгота приведена к 0–360°, добавлены point и distance_km. Координаты и высоты из опубликованного shapefile не подгонялись к общему уровню и не сглаживались. Для графика используйте distance_km и height_m. Для проверки модели уровень выбирают только по A; после открытия B его сохраняют неизменным.

В исходном архиве атрибут Lat и CSV-столбец Lat отличаются от геометрии указанного shapefile на 0.3378834628279°. В подготовленных файлах взята именно геометрия, соответствующая опубликованному слою, а не старый атрибут Lat. Не заменяйте координаты обратным копированием CSV.Lat и не пересчитывайте для контроля высоты по грубой модели. Другой столбец исходного CSV, Elev_m_orig, — отдельная серия исходных высот Ivanov; в этот контроль он не входит.

Цитирование: Sholes, S. F., Dickeson, Z. I., Montgomery, D. R., & Catling, D. C. (2021). Data For: Where are Mars' Hypothesized Ocean Shorelines? Large Lateral and Topographic Offsets Between Different Versions of Paleoshoreline Maps, v2.0.1. https://doi.org/10.5281/zenodo.4666803. Исходная версия линии: Ivanov, M. A., Erkeling, G., Hiesinger, H., Bernhardt, H., & Reiss, D. (2017). Topography of the Deuteronilus contact on Mars: Evidence for an ancient water/mud ocean and long-wavelength topographic readjustments. Planetary and Space Science, 144, 49–70. https://doi.org/10.1016/j.pss.2017.05.012.

3. Граница вывода

Число видимых каталогизированных кратеров не даёт единственного возраста поверхности. На число влияют накопление ударов и последующее изменение поверхности; полушария включают разные геологические области. Два профиля показывают различие выбранной пары, а не всех кратеров полушарий.

Два фрагмента Deuteronilus проверяют, описывает ли один уровень выбранные опубликованные высоты на современном рельефе. Несовпадение само по себе не доказывает отсутствия древнего океана: нужно различать последующее изменение рельефа, разные уровни/времена образования следов и неоднозначность геологической интерпретации линии. При отсутствии высот приложение должно показать недостаток данных, а не подставить нули.
