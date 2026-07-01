# Arquitetura do Fincheck API

---

## Arquitetura do Professor (original)

### Estrutura de pastas

```
src/
  app.module.ts
  main.ts
  modules/
    users/
      dto/
        create-user.dto.ts
      users.controller.ts
      users.module.ts
      users.service.ts
  shared/
    database/
      database.module.ts
      prisma.service.ts
      repositories/
        users.repository.ts
```

### O que cada parte faz

**`modules/users/`**
Agrupa tudo relacionado a usuários em um só lugar — controller, service e DTOs. Não há separação explícita de camadas: lógica de negócio, HTTP e acesso a dados coexistem no mesmo nível.

**`shared/database/`**
Concentra toda a infraestrutura de banco de dados de forma global. O `DatabaseModule` é marcado como `@Global()` e exporta tanto o `PrismaService` quanto o `UsersRepository`, tornando-os disponíveis em qualquer módulo sem necessidade de importação explícita.

**`UsersRepository`** (em `shared/database/repositories/`)
Classe concreta, injetável, que encapsula as queries do Prisma. Recebe `Prisma.UserCreateArgs` e `Prisma.UserFindUniqueArgs` diretamente — ou seja, a interface do repositório é ditada pelo Prisma.

**`UsersService`**
Depende diretamente de `UsersRepository` (implementação concreta). Contém a lógica de negócio: hash de senha, verificação de email duplicado e criação de categorias default.

### Fluxo

```
Request
   ↓
Pipe (ValidationPipe)     → valida o DTO
   ↓
UsersController           → recebe e delega
   ↓
UsersService              → lógica de negócio
   ↓
UsersRepository           → classe concreta, usa Prisma diretamente
   ↓
PrismaService             → executa query no PostgreSQL
   ↓
Response
```

### Limitações

- `UsersService` depende de `UsersRepository` concreto — trocar ORM exige mexer no service
- `UsersRepository` expõe tipos do Prisma (`Prisma.UserCreateArgs`) para cima, vazando detalhes de infra para camadas superiores
- Não há separação clara entre regra de negócio e detalhe de implementação
- Difícil testar `UsersService` em isolamento sem instanciar o Prisma

---

## Arquitetura Clean (atual)

### Estrutura de pastas

```
src/
  app.module.ts
  main.ts
  modules/
    users/
      domain/
        repositories/
          users.repository.ts     ← contrato abstrato
      application/
        users.service.ts          ← lógica de negócio
        users.service.spec.ts
      infra/
        http/
          dto/
            create-user.dto.ts
          users.controller.ts
          users.controller.spec.ts
        database/
          users.prisma.repository.ts   ← implementação Prisma
      users.module.ts             ← wiring (bind abstrato → concreto)
  shared/
    database/
      database.module.ts          ← só PrismaService (global)
      prisma.service.ts
```

### O que cada camada faz

**`domain/`**
O núcleo da aplicação. Contém apenas contratos — sem framework, sem ORM, sem HTTP. Define *o que* o repositório deve fazer, não *como*. É a camada mais estável: raramente muda, independente de tecnologia.

```ts
// domain/repositories/users.repository.ts
export abstract class UsersRepository {
  abstract create(data: Prisma.UserCreateInput): Promise<User>;
  abstract findUnique(where: Prisma.UserWhereUniqueInput, select?: Prisma.UserSelect): Promise<Partial<User> | null>;
}
```

> **Por que `abstract class` e não `interface`?**
> TypeScript apaga interfaces em runtime. O NestJS precisa de um token real para injeção de dependência — `abstract class` sobrevive à compilação e serve como token.

**`application/`**
Lógica de negócio pura. Não sabe que existe Prisma, HTTP ou qualquer framework. Depende apenas do contrato definido em `domain/`. Aqui ficam as regras: validar email único, hash de senha, seeds de categorias.

**`infra/http/`**
Tudo relacionado ao protocolo HTTP: controller, DTOs, pipes. Recebe a request, valida com `class-validator`, delega para o service e devolve a response. Não contém regra de negócio.

**`infra/database/`**
Implementação concreta do repositório usando Prisma. É a única camada que conhece SQL, ORM ou driver. Se amanhã o Prisma for substituído por TypeORM ou Drizzle, só essa pasta muda.

**`users.module.ts`**
O "fiador" da inversão de dependência. Diz ao NestJS: quando alguém solicitar `UsersRepository` (abstrato), entregue `UsersPrismaRepository` (concreto). Esse bind é a chave da arquitetura.

```ts
providers: [
  UsersService,
  {
    provide: UsersRepository,       // quem pede
    useClass: UsersPrismaRepository // quem entrega
  }
]
```

**`shared/database/`**
Infraestrutura compartilhada. Exporta apenas `PrismaService` — o cliente do banco. Repositórios concretos ficam dentro de cada módulo, não aqui.

### Fluxo completo

```
Request HTTP
   ↓
Middleware               → CORS, logging (global, antes de tudo)
   ↓
Guard                   → JWT válido? usuário tem permissão?
   ↓
Interceptor             → transforma/loga antes do handler
   ↓
Pipe (ValidationPipe)   → valida e transforma o DTO (class-validator)
   ↓
Controller              → recebe CreateUserDto, delega para UsersService
   ↓  [infra/http]
Service                 → valida email duplicado, hash senha, cria usuário
   ↓  [application]
UsersRepository         → contrato abstrato (domain)
   ↓
UsersPrismaRepository   → executa query no PostgreSQL via Prisma
   ↓  [infra/database]
PrismaService           → driver Prisma + adapter PrismaPg
   ↓
PostgreSQL
   ↑
Interceptor             → transforma resposta se necessário
   ↑
Response HTTP
```

### Como trocar o ORM

1. Criar `UsersTypeOrmRepository implements UsersRepository`
2. Trocar `useClass: UsersPrismaRepository` por `useClass: UsersTypeOrmRepository` no `users.module.ts`
3. `UsersService`, `UsersController` e `domain/` não mudam

---

## Comparação

| | Professor | Clean Arch |
|---|---|---|
| **Separação de camadas** | Implícita | Explícita (`domain`, `application`, `infra`) |
| **Dependências** | Service → implementação concreta | Service → abstração (contrato) |
| **Tipos vazados** | `Prisma.UserCreateArgs` chega no service | Service usa tipos próprios ou do domínio |
| **Trocar ORM** | Mexe em service + repository | Só cria nova impl, troca `useClass` |
| **Testabilidade** | Precisa mockar Prisma inteiro | Mocka a abstract class com poucos métodos |
| **Onde está a regra de negócio** | Misturada com infra no service | Isolada em `application/` |
| **Curva de aprendizado** | Baixa | Média |
| **Overhead de arquivos** | Baixo | Médio (mais pastas, mais arquivos) |
| **Escalabilidade em time** | Limita com o crescimento | Cada camada tem dono e responsabilidade clara |

### Quando usar cada uma

**Arquitetura do professor** → protótipos, MVPs, projetos solo de curto prazo onde velocidade importa mais que estrutura.

**Clean Arch** → projetos com múltiplos devs, longa vida útil, domínio complexo ou quando testabilidade e substituição de dependências são requisitos reais.
