# laptop-crew

Un mod para Claude Code: la mascota de Claude trabaja escondida detrás de una laptop en la franja de encima del prompt y, cuando termina una tarea, se asoma con un **!** rojo y un sonido de alerta.

- **Este chat** es la mascota grande. Escondida y tecleando mientras trabaja, asomada con el **!** al terminar y dormida (con una "z") en espera.
- **Subagentes** de este chat aparecen como mascotas pequeñas al lado, hasta 3. Si hay más, la última muestra un **+N**.
- **Sonido** al salir el **!**: el grande para este chat, uno más agudo y bajito para sus subagentes. Puedes usar tu propio `.wav`; la versión aguda se crea sola.
- Si otro mod ya dibuja en esa franja (por ejemplo ponytail), las mascotas se acomodan a un lado sin taparlo.

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
| Dónde se muestran | En la franja, en el indicador de trabajo (mascota pequeña tecleando) y en una fila con el ! al final del chat (la app de escritorio todavía no dibuja esas filas); cada una se activa o desactiva |

El panel también tiene botones para probar cada animación y el sonido.

## Notas

- En Windows el sonido se reproduce con el reproductor del sistema (PowerShell); en macOS, con el de Claude Code.
- Cada chat muestra y suena solo por lo suyo: este chat y sus subagentes. Otro chat abierto tiene su propia mascota.
