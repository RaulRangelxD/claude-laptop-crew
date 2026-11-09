# laptop-crew

Un mod para Claude Code: la mascota de Claude trabaja escondida detrás de una laptop en la franja de encima del prompt y, cuando termina una tarea, se asoma con un **!** rojo y un sonido de alerta.

- **Este chat** es la mascota grande. Escondida y tecleando mientras trabaja, asomada con el **!** al terminar y dormida (con una "z") en espera.
- **Subagentes** de este chat aparecen como mascotas pequeñas al lado, hasta 3. Si hay más, la última muestra un **+N**.
- **Sonido** al salir el **!**: el grande para este chat, uno más agudo y bajito para sus subagentes. Puedes usar tu propio `.wav`; la versión aguda se crea sola.
- Si otro mod ya dibuja en esa franja (por ejemplo ponytail), las mascotas se acomodan a un lado sin taparlo. Si en vez de eso salen **debajo**, mira [¿Las mascotas salen debajo de ponytail?](#las-mascotas-salen-debajo-de-ponytail).

## Instalar

En una terminal con `claude`:

```
/plugin install laptop-crew --marketplace RaulRangelxD/claude-laptop-crew
```

Responde `y` para agregar el marketplace y elige el alcance de usuario (Enter). Desde una shell también sirve:

```
claude plugin install laptop-crew --marketplace RaulRangelxD/claude-laptop-crew
```

En la app de escritorio, donde `/plugin` no funciona: pulsa **+** junto a la caja del prompt, luego **Plugins**, **Add marketplace** con `RaulRangelxD/claude-laptop-crew` y después **Add plugin**.

## ¿Las mascotas salen debajo de ponytail?

> [!IMPORTANT]
> Si ya tenías **ponytail** (u otro mod que dibuja encima del prompt) y luego instalaste laptop-crew, las mascotas salen **debajo** de su menú en vez de a un lado. Se arregla en un minuto:

1. Abre el archivo de ajustes de Claude Code con un editor de texto:
   - Windows: `C:\Users\<tu usuario>\.claude\settings.json` (o escribe `%USERPROFILE%\.claude\settings.json` en la barra del Explorador)
   - macOS y Linux: `~/.claude/settings.json`
2. Busca `"enabledPlugins"` y mueve la línea de laptop-crew **arriba** de la de ponytail:

   ```json
   "enabledPlugins": {
     "laptop-crew@claude-laptop-crew": true,
     "ponytail@ponytail": true
   }
   ```

   Cuida las comas: todas las líneas llevan coma al final menos la última.
3. Guarda el archivo y reinicia Claude Code (cierra la app por completo y vuelve a abrirla).

**Por qué pasa:** al instalar, Claude Code pone el plugin nuevo al final de esa lista, y el que va primero es el que acomoda la franja. Con laptop-crew primero, recibe el menú de ponytail y se pone a su lado; con ponytail primero, ponytail pone las mascotas debajo. El mod no puede cambiar ese orden por sí solo.

El panel `/crew` también lo recuerda en la sección **Posición**.

## Opciones

Escribe `/crew` para abrir el panel de opciones (también están en `/config`):

| Opción | Qué hace |
|---|---|
| Sonido | Activa o desactiva los sonidos |
| Volumen general | Volumen de ambos sonidos, de 0 a 100 |
| Volumen de las pequeñas | En % del volumen general |
| Audio propio | Ruta a un `.wav` de 16 bits; la versión aguda se crea sola |
| Duración del ! | Segundos antes de volver a dormir |
| Mascotas pequeñas | De 0 a 3; con 0 solo se muestra este chat |
| Tamaño | Normal, o compacto: este chat como mascota pequeña y sus subagentes como un número (rojo si alguno terminó) |
| Colores | De la mascota y de la laptop, en hexadecimal |
| Posición | Con la franja vacía (centro, derecha, izquierda), junto a otro contenido y lado de las pequeñas |
| Dónde se muestran | En la franja, en el indicador de trabajo (mascota pequeña tecleando), en una fila con el ! al final del chat (la app de escritorio todavía no dibuja esas filas) y en el panel lateral de la derecha (apagado de inicio); cada una se activa o desactiva |

El panel también tiene botones para probar cada animación y el sonido. En la app de escritorio, donde `/config` no lista las opciones del mod, el panel las guarda en el almacén del propio mod.

## Notas

- En Windows el sonido se reproduce con el reproductor del sistema (PowerShell); en macOS, con el de Claude Code.
- Cada chat muestra y suena solo por lo suyo: este chat y sus subagentes. Otro chat abierto tiene su propia mascota.
