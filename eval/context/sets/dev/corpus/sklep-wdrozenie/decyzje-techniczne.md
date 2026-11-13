# Decyzje techniczne

Krótkie uzasadnienia wyborów, żeby nie wracać do tych samych dyskusji.

## 1. PostgreSQL zamiast MySQL

Potrzebujemy wyszukiwania po tytułach i autorach bez osobnego silnika. PostgreSQL ma wbudowane wyszukiwanie pełnotekstowe i dobre typy JSON na atrybuty książek. Zespół zna go lepiej.

## 2. Kolejka zadań na Redisie

Osobny broker wiadomości to kolejny element do utrzymania i monitorowania. Redis i tak jest potrzebny na sesje i koszyki, więc kolejka działa na nim. Wrócimy do tematu, jeśli liczba zadań przekroczy kilkadziesiąt tysięcy na godzinę.

## 3. Renderowanie po stronie serwera

Strony książek muszą być dobrze widoczne w wyszukiwarkach. Renderowanie po stronie serwera daje pełną treść strony od razu, bez czekania na skrypty.

## 4. Jedna aplikacja zamiast mikroserwisów

Czteroosobowy zespół nie utrzyma kilkunastu usług. Granice modułów trzymamy w kodzie, a nie w sieci.

## 5. Import z hurtowni raz na dobę

Hurtownia na start udostępnia tylko plik CSV. Częstszy import nie ma sensu, bo plik zmienia się raz dziennie.
