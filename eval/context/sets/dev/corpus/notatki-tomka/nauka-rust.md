# Notatki z nauki Rusta

## Własność i pożyczanie

- Każda wartość ma jednego właściciela. Przypisanie przenosi własność, chyba że typ jest kopiowalny.
- Pożyczka niemutowalna może istnieć wiele razy naraz, mutowalna tylko jedna.
- Kompilator odrzuca odwołanie, które żyje dłużej niż wartość.

## Obsługa błędów

- `Result` zamiast wyjątków. Operator `?` przekazuje błąd wyżej.
- `unwrap` tylko w testach i prototypach.

## Plan

- Przepisać narzędzie do ponawiania webhooków jako ćwiczenie.
- Jeden rozdział książki tygodniowo, do końca roku.
