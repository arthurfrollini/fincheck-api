// Every user is created with these. The categorization golden set labels
// against these exact names.
export const DEFAULT_CATEGORIES = [
  { name: 'Salário', icon: 'salary', type: 'INCOME' as const },
  { name: 'Freelance', icon: 'freelance', type: 'INCOME' as const },
  { name: 'Outro', icon: 'other', type: 'INCOME' as const },
  { name: 'Casa', icon: 'home', type: 'EXPENSE' as const },
  { name: 'Alimentação', icon: 'food', type: 'EXPENSE' as const },
  { name: 'Educação', icon: 'education', type: 'EXPENSE' as const },
  { name: 'Lazer', icon: 'fun', type: 'EXPENSE' as const },
  { name: 'Mercado', icon: 'grocery', type: 'EXPENSE' as const },
  { name: 'Roupas', icon: 'clothes', type: 'EXPENSE' as const },
  { name: 'Transporte', icon: 'transport', type: 'EXPENSE' as const },
  { name: 'Viagem', icon: 'travel', type: 'EXPENSE' as const },
  { name: 'Outro', icon: 'other', type: 'EXPENSE' as const },
];
