# Testy wydajności przed startem

Termin: 4–8 maja 2026. Środowisko: kopia produkcji z pełnym katalogiem.

## Cel

Umowa wymaga obsługi 600 zamówień na minutę w szczycie.

## Przebieg

Każdy test trwał 30 minut. Ruch odtwarzał typową ścieżkę: wyszukiwanie, strona książki, koszyk, płatność testowa.

## Wyniki

| Próba | Zamówienia na minutę | Czas odpowiedzi p95 |
| --- | --- | --- |
| Pierwsza | 850 | 420 ms |
| Po optymalizacji | 1100 | 310 ms |

W pierwszej próbie sklep wytrzymał 850 zamówień na minutę. Wąskim gardłem było generowanie faktur PDF, które blokowało workera. Po przeniesieniu faktur do osobnej kolejki sklep obsłużył 1100 zamówień na minutę.

## Wnioski

- Cel z umowy jest spełniony z zapasem.
- Replika bazy przejmuje około 70% odczytów katalogu.
- Przy 1300 zamówieniach na minutę zaczyna brakować połączeń do bazy. To granica obecnej konfiguracji.
