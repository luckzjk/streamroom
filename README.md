# StreamRoom

Site de salas com convite para transmissao de tela via WebRTC.

Cada sala pode ter nome proprio e limite de participantes. Dentro da sala, cada pessoa pode salvar o nome exibido e uma foto local, que aparecem para os outros participantes conectados.

## Rodar localmente

```bash
npm start
```

Abra `http://127.0.0.1:5173/`.

Use o painel "Nova sala" para escolher nome e limite de pessoas. O link de convite da sala atual aparece no painel "Sala atual".

## Publicar

Publique como um app Node.js. O comando de start e:

```bash
npm start
```

O navegador so permite capturar tela em contexto seguro, entao em producao use HTTPS.

## Variaveis de ambiente

Opcional, mas recomendado para amigos fora da sua rede:

```bash
STUN_URL=stun:stun.l.google.com:19302
TURN_URL=turn:seu-turn.com:3478
TURN_USERNAME=usuario
TURN_CREDENTIAL=senha
```

Sem TURN, algumas redes vao conectar bem e outras podem falhar.

Depois de alterar os arquivos, faca redeploy do app Node.js na plataforma onde ele esta hospedado.
