# Movimento — Avaliação Física Beta

Protótipo local em português para testar cadastro de alunos, avaliações por módulos, histórico, antropometria, checklist postural, testes físicos e impressão de relatório em PDF.

## Iniciar no Windows

1. Instale Node.js 24 ou superior. O app usa o módulo embutido `node:sqlite` e não precisa baixar dependências.
2. Abra esta pasta e execute `iniciar.bat`, ou rode `node server.mjs` no terminal.
3. Abra `http://127.0.0.1:4173` no navegador.
4. Para encerrar, feche a janela do terminal ou pressione Ctrl+C.

O servidor escuta apenas em `127.0.0.1`; ele não fica acessível na rede local por padrão. Os dados são gravados em `data/avaliacoes.sqlite`. Imagens são opcionais e, quando anexadas, ficam dentro do registro no banco local.

## Acessar pelo celular na mesma rede Wi-Fi

1. Inicie `iniciar-celular.bat` no computador. Esse modo permite conexões pela rede local.
2. Se o Firewall do Windows perguntar, permita o Node.js apenas em redes privadas.
3. No computador, rode `ipconfig` e localize o endereço IPv4 da conexão Wi-Fi, por exemplo `192.168.1.20`.
4. No celular conectado à mesma rede Wi-Fi, abra `http://192.168.1.20:4173` (substitua pelo IPv4 mostrado no seu computador).
5. Android: no Chrome, menu ⋮ → **Adicionar à tela inicial**. iPhone: abra no Safari → **Compartilhar** → **Adicionar à Tela de Início**.

O computador precisa ficar ligado e o celular na mesma rede. O ícone é um atalho para o app que continua rodando no computador; os registros ficam no banco SQLite desse computador. O beta não tem login nem HTTPS, portanto use apenas em uma rede privada confiável e com dados fictícios. Para instalar como PWA segura e acessar fora de casa, será necessário hospedar o servidor com HTTPS, autenticação e armazenamento persistente protegido.

## Acesso remoto privado sem mensalidade de servidor

Para testar fora de casa sem contratar VPS, é possível usar Tailscale Serve. Instale o Tailscale no computador e no celular, entre na mesma conta pessoal nos dois, e deixe o servidor local rodando com `iniciar.bat`. Em seguida, abra o Terminal como administrador no Windows e execute `tailscale serve --bg 4173`. Na primeira vez, siga a tela de consentimento para habilitar HTTPS. O Tailscale exibirá um endereço HTTPS `*.ts.net`; abra esse endereço no celular com o Tailscale conectado e adicione-o à tela inicial pelo navegador. O Serve mantém o endereço privado à sua rede Tailscale e encaminha para o app em `127.0.0.1:4173`; pare o compartilhamento com `tailscale serve --https=443 off`.

Esse caminho não é hospedagem em nuvem: o computador precisa ficar ligado, online e com o app aberto; se não houver internet, o celular fora de casa não chega até ele. A tela pode ser adicionada como atalho, mas o aplicativo cliente do Tailscale precisa estar instalado no celular para entrar na rede privada. O plano gratuito Tailscale Personal é destinado a uso pessoal não comercial; confirme os termos antes de usá-lo em atividade profissional. Mantenha dados fictícios durante os testes. Consulte o plano e os limites atuais antes de escolher: https://tailscale.com/pricing.

## Hospedar na internet

O projeto inclui uma configuração Docker Compose para um VPS Linux. Ela mantém a aplicação e o SQLite em uma pasta persistente no disco do servidor, põe o Caddy na frente para HTTPS automático e exige login por senha. O banco vazio em produção não recebe os registros de demonstração.

Pré-requisitos: domínio próprio com DNS apontado para o IP do VPS, Docker com Compose, e portas 80 e 443 liberadas no firewall do servidor. No VPS, copie o projeto e crie `.env` com base em `.env.example`; defina `DOMAIN`, `DATA_STORE=supabase`, `SUPABASE_URL`, `SUPABASE_SECRET_KEY` e `APP_PASSWORD_HASH`. Gere o hash com `node scripts/gerar-hash-senha.mjs` e proteja o arquivo (`chmod 600 .env`). O script solicita a senha sem exibi-la; use pelo menos 14 caracteres. Crie as tabelas executando `supabase/schema.sql` no SQL Editor do projeto Supabase. Para importar os dados locais, preencha essas mesmas variáveis no `.env` deste computador e rode `node scripts/migrar-sqlite-supabase.mjs` **antes** de iniciar o app em nuvem. Em seguida, rode `docker compose up -d --build`. O login estará no endereço HTTPS do domínio.

`docker-compose.yml`, `Dockerfile` e `Caddyfile` são a configuração-base. A pasta `data` mantém o SQLite local e é excluída da imagem; com `DATA_STORE=supabase`, os cadastros e avaliações hospedados ficam no PostgreSQL do Supabase. Use o botão de backup JSON do app e estabeleça também uma rotina de cópia do banco remoto antes de usar dados reais. Este beta ainda não oferece redefinição de senha, múltiplos usuários, auditoria de acesso ou restauração de backup pela interface.

O atalho da tela inicial passa a apontar para o domínio HTTPS. O servidor fica ligado independentemente do computador pessoal. O modo local continua disponível sem login quando executado por `iniciar.bat`.

## O que funciona

- Cadastro simples e histórico sem limite artificial de avaliações.
- Modalidades combináveis: antropometria, postural e testes físicos.
- Peso, estatura, IMC, 18 perímetros corporais em cm, diâmetros ósseos e coleta de dobras. Quando uma equação requer converter densidade em %G, a conversão matemática é automática e não aparece como escolha na interface.
- Nos testes físicos, o campo de lado começa como Direito e pode ser ajustado para Esquerdo ou Ambos.
- Cálculos estimados identificados para JP7, Petroski, Durnin–Womersley e Yuhasz/Carter. Guedes aguarda revisão final da transcrição. Slaughter calcula apenas quando a variante, os sítios, a soma, a maturação e os dados adicionais exigidos pela tabela estão disponíveis; fora disso, mostra aviso.
- Checklist de postura por vista, fotos opcionais por vista, simetrógrafo vermelho alternável, marcação livre D/E em dois cliques com ângulo, segmentos para ombros/escápulas/pelve/cabeça nas vistas frontal e posterior e alinhamento tragion–tornozelo na lateral. Marcações acompanham a foto no relatório; escoliómetro e goniometria são manuais.
- Catálogo de força, potência, cardiorrespiratório e testes clínicos com status, resultado, valor e dor.
- Sinais vitais em repouso opcionais e entrada manual de frequência cardíaca nos campos dos testes.
- Histórico cronológico, comparação lado a lado das avaliações selecionadas e exportação de PDF em versão resumida (indicadores, evolução e observações principais) ou completa (composição corporal, medidas, postura, testes e detalhes de cada data); fotos opcionais.
- Download de cópia dos registros em JSON.

## Limites desta beta

- Usar somente dados fictícios até revisar armazenamento, consentimento, acesso, backup e proteção das informações de saúde.
- Equações de campo geram estimativas. Confira população, unidade, versão e protocolo no `apendice_tecnico_avaliacao_fisica.md` antes de usar um resultado.
- A fórmula Guedes deve passar pela revisão final da transcrição original antes de seu uso operacional.
- Slaughter exige maturação e variante apropriadas. ATSI/POTSI, análise automática por foto/vídeo, recomendações clínicas e integração Polar/smartwatch não foram implementados.
- Os testes de dor registram observações e sintomas; não diagnosticam. O relatório é um registro do avaliador.
- O PDF é gerado pelo comando de impressão do navegador (escolha “Salvar como PDF”).
- O modo local não tem autenticação. A configuração de hospedagem ativa um login único por senha; ainda não existe múltiplos usuários, redefinição de senha, auditoria de acesso, sincronização entre servidores, compartilhamento automático ou restauração de backup pela interface. SQLite não impõe limite de avaliações no app, mas o armazenamento contratado e os backups são finitos.

## Documentação do produto

- `contexto_app_avaliacao_fisica_beta.md`
- `apendice_tecnico_avaliacao_fisica.md`
- `prompt_programacao_beta_avaliacao_fisica.md`

No modo local, os registros persistidos ficam no computador onde o servidor foi executado. No modo hospedado, ficam no volume do VPS. Faça cópias de segurança regulares e confirme que consegue restaurá-las antes de usar registros reais.

## Usar Supabase na versão hospedada

SQLite é o banco local do beta; Supabase oferece PostgreSQL gerenciado na nuvem. A API agora pode usar SQLite localmente ou Supabase quando `DATA_STORE=supabase`. A aplicação Node continua servindo como API privada e mantém o login por senha. A chave secreta do Supabase fica somente no `.env` do servidor e nunca nos arquivos de `public/`.

1. Crie um projeto Supabase e execute `supabase/schema.sql` no SQL Editor do projeto.
2. Copie a Project URL e a chave `sb_secret_...` do painel para `.env`, junto com `DATA_STORE=supabase`. Não envie a chave por e-mail ou chat, nem a salve no repositório.
3. Rode uma vez `node scripts/migrar-sqlite-supabase.mjs` neste computador para importar alunos e avaliações existentes. O script usa `legacy_id` para continuar com segurança se precisar ser retomado; não apaga nem substitui registros que já foram importados.
4. Hospede a API Node com Docker e HTTPS conforme o restante deste guia. O volume SQLite pode continuar montado como cópia local, mas as operações hospedadas usam Supabase.

O modo offline no celular ainda é uma etapa separada, que exige armazenamento local no navegador e sincronização posterior; Supabase fornece o banco remoto, mas não substitui essa função.

