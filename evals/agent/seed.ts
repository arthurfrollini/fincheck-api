import { type PrismaClient } from '@prisma/client';
import { DEFAULT_CATEGORIES } from '@modules/categories/entities/default-categories';

// One synthetic user, two months, 40 transactions. Every expected answer in
// cases.jsonl is recomputed from this list by seed.spec.ts, so a typo in a
// case can't hide.
export const EVAL_USER_EMAIL = 'agent-eval@fincheck.local';
export const EVAL_NOW = new Date('2026-10-16T12:00:00.000Z');

type Kind = 'INCOME' | 'EXPENSE';
export interface SeedTx {
  date: string;
  name: string;
  value: number;
  type: Kind;
  category: string | null;
}

const e = (
  date: string,
  name: string,
  value: number,
  category: string | null,
): SeedTx => ({ date, name, value, type: 'EXPENSE', category });
const i = (
  date: string,
  name: string,
  value: number,
  category: string,
): SeedTx => ({ date, name, value, type: 'INCOME', category });

export const SEED: SeedTx[] = [
  i('2026-08-05', 'Salário ACME', 6000, 'Salário'),
  i('2026-08-20', 'Freela site', 1500, 'Freelance'),
  e('2026-08-02', 'Aluguel', 1800, 'Casa'),
  e('2026-08-10', 'Conta de luz', 210.4, 'Casa'),
  e('2026-08-03', 'Assaí', 320.15, 'Mercado'),
  e('2026-08-17', 'Mercado Lolali', 85.3, 'Mercado'),
  e('2026-08-24', 'Assaí', 190, 'Mercado'),
  e('2026-08-06', '99 Food', 45.9, 'Alimentação'),
  e('2026-08-13', 'Restaurante', 120, 'Alimentação'),
  e('2026-08-27', '99 Food', 38.5, 'Alimentação'),
  e('2026-08-08', 'Uber', 32.4, 'Transporte'),
  e('2026-08-15', 'Posto Shell', 250, 'Transporte'),
  e('2026-08-22', 'Uber', 27.6, 'Transporte'),
  e('2026-08-11', 'Spotify', 23.9, 'Lazer'),
  e('2026-08-19', 'Cinema', 64, 'Lazer'),
  e('2026-08-25', 'Curso Alura', 89.9, 'Educação'),
  e('2026-08-29', 'Renner', 199.9, 'Roupas'),
  e('2026-08-30', 'Farmácia', 54.99, 'Outro'),
  i('2026-09-05', 'Salário ACME', 6000, 'Salário'),
  i('2026-09-18', 'Freela app', 2200, 'Freelance'),
  i('2026-09-25', 'Rendimento poupança', 12.37, 'Outro'),
  e('2026-09-02', 'Aluguel', 1800, 'Casa'),
  e('2026-09-10', 'Conta de luz', 198.6, 'Casa'),
  e('2026-09-04', 'Assaí', 287.45, 'Mercado'),
  e('2026-09-14', 'Mercado Lolali', 63.2, 'Mercado'),
  e('2026-09-26', 'Assaí', 211.8, 'Mercado'),
  e('2026-09-03', '99 Food', 52.3, 'Alimentação'),
  e('2026-09-09', 'Restaurante', 148, 'Alimentação'),
  e('2026-09-16', '99 Food', 41.7, 'Alimentação'),
  e('2026-09-21', 'Padaria', 23.5, 'Alimentação'),
  e('2026-09-28', '99 Food', 36.87, 'Alimentação'),
  e('2026-09-07', 'Uber', 29.9, 'Transporte'),
  e('2026-09-12', 'Posto Shell', 230, 'Transporte'),
  e('2026-09-23', 'Uber', 44.1, 'Transporte'),
  e('2026-09-11', 'Spotify', 23.9, 'Lazer'),
  e('2026-09-20', 'Ingresso festival', 550, 'Lazer'),
  e('2026-09-24', 'Álamo Rent-a-car', 1200, 'Viagem'),
  e('2026-09-27', 'Livraria', 79.9, 'Educação'),
  e('2026-09-29', 'Farmácia', 61.2, 'Outro'),
  e('2026-09-30', 'PIX ENVIADO', 100, null),
];

// Recreates the eval user from scratch (cascades its rows), so every run
// sees exactly SEED. Returns the user id.
export async function seedEvalUser(prisma: PrismaClient): Promise<string> {
  await prisma.user.deleteMany({ where: { email: EVAL_USER_EMAIL } });
  const user = await prisma.user.create({
    data: {
      name: 'Agent Eval',
      email: EVAL_USER_EMAIL,
      categories: {
        createMany: { data: DEFAULT_CATEGORIES.map((c) => ({ ...c })) },
      },
    },
    include: { categories: true },
  });
  const bank = await prisma.bankAccount.create({
    data: {
      userId: user.id,
      name: 'Conta',
      initialBalance: 0,
      type: 'CHECKING',
      color: '#000',
    },
  });
  const categoryId = (name: string | null, type: Kind) =>
    name === null
      ? null
      : user.categories.find((c) => c.name === name && c.type === type)!.id;
  await prisma.transaction.createMany({
    data: SEED.map((t) => ({
      userId: user.id,
      bankAccountId: bank.id,
      categoryId: categoryId(t.category, t.type),
      name: t.name,
      value: t.value,
      date: new Date(`${t.date}T12:00:00.000Z`),
      type: t.type,
    })),
  });
  return user.id;
}
