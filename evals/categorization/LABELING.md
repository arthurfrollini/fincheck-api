# Categorization golden set

50 transactions labeled with the category a person would choose, used by `npm run eval:categorization` to measure how often the production categorization agrees.

## Provenance

- **41 real cases (`r01`-`r41`)**: 40 come from the repo owner's September 2026 Nubank credit card statement and 1 (`VESTUARIO E CIA LTDA`) from the account statement. The owner labeled them all by hand on 2026-10-16. Values are the real amounts. A merchant registered under a private person's name was left out because this repo is public.
- **9 synthetic cases (`s01`-`s09`)**: written to cover what one card statement lacks: INCOME transactions, raw bank-style strings (`PAG*`, `TED RECEBIDA`, `PIX ENVIADO`), and transactions that carry no information (`none`).

Results are reported separately by `source`, so the real-only number is always visible.

## Labels

Each label is one of the 12 categories every user starts with (`src/modules/categories/entities/default-categories.ts`), or `none`.

- **INCOME:** Salário, Freelance, Outro.
- **EXPENSE:** Casa, Alimentação, Educação, Lazer, Mercado, Roupas, Transporte, Viagem, Outro.

`none` means a person could not tell what the transaction is from its text alone. It is not the same as `Outro`, which means "I know what this is, and it has no specific category".

## Rules applied

| Kind of transaction                                                            | Label       | Examples                                                     |
| ------------------------------------------------------------------------------ | ----------- | ------------------------------------------------------------ |
| Streaming, games, events, tickets                                              | Lazer       | Spotify, Amazon Prime, Ticketmaster, Inti *Tomorrowland, Zig |
| Delivery apps, restaurants, food shops                                         | Alimentação | 99 Food, Zé Delivery, Cacau Show, Plurall                    |
| Supermarkets, convenience stores                                               | Mercado     | Assaí, OXXO                                                  |
| Ride-hailing, tolls, fuel, car insurance                                       | Transporte  | Uber, 99, NuTag, 7-Eleven (fuel, abroad), Tokio Marine (car) |
| Car rental on a trip                                                           | Viagem      | Álamo Rent-a-car                                             |
| Pharmacy, barber, software and AI subscriptions, unknown marketplace purchases | Outro       | Drogasil, Mp *Barbearia, ANTHROPIC, ChatGPT, Apple, Amazon   |
| No recognizable merchant or purpose                                            | none        | Stb*Fdintermediacaoese, PIX ENVIADO, PAG*JOSEDASILVA         |

Cases marked `"note": "debated label"` are the 13 the owner decided individually. They are the ones where two categories were defensible, so a model "miss" on them deserves a look before a prompt change.

## Known limitations

- **The real names are cleaner than raw statement text.** The Nubank app shows normalized merchant names ("99 Food", "Uber"), not the strings a bank file contains (`DL*99FOOD`, `UBER *TRIP`). Only a few real cases are raw (`Mp *Barbearia`, `Stb*...`, `NuTag*ECD2D34`, `Inti *Tomorrowland`). Accuracy on raw exports is likely lower than this set shows.
- **One person, one month.** Spending patterns, and therefore category balance, are one user's. Mercado and Alimentação are over-represented, and Educação and Roupas barely appear.
- **One labeler.** No inter-annotator agreement was measured.
