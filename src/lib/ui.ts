/**
 * Terminal UI styling for Contextador
 * Purple brand, green success, red errors
 */

// ANSI color codes
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

// Brand colors
const PURPLE = "\x1b[38;2;168;85;247m";     // #a855f7
const LIGHT_PURPLE = "\x1b[38;2;192;132;252m"; // #c084fc
const GREEN = "\x1b[38;2;74;222;128m";       // #4ade80
const RED = "\x1b[38;2;248;113;113m";        // #f87171
const YELLOW = "\x1b[38;2;250;204;21m";      // #facc15
const GRAY = "\x1b[38;2;156;163;175m";       // #9ca3af
const WHITE = "\x1b[38;2;243;244;246m";      // #f3f4f6

export const c = {
  purple: (s: string) => `${PURPLE}${s}${RESET}`,
  lpurple: (s: string) => `${LIGHT_PURPLE}${s}${RESET}`,
  green: (s: string) => `${GREEN}${s}${RESET}`,
  red: (s: string) => `${RED}${s}${RESET}`,
  yellow: (s: string) => `${YELLOW}${s}${RESET}`,
  gray: (s: string) => `${GRAY}${s}${RESET}`,
  white: (s: string) => `${WHITE}${s}${RESET}`,
  bold: (s: string) => `${BOLD}${s}${RESET}`,
  dim: (s: string) => `${DIM}${s}${RESET}`,
  bpurple: (s: string) => `${BOLD}${PURPLE}${s}${RESET}`,
  bgreen: (s: string) => `${BOLD}${GREEN}${s}${RESET}`,
  bred: (s: string) => `${BOLD}${RED}${s}${RESET}`,
};

export function banner() {
  const art = `                                                                                        ....                                                   ..               ......
                                                                                     .  .  .  .                                             .......  .................
                                                                                  ...   . .  . .                                         .. .--.... ----........-----..
                                                                                .  ..    .                                         .. ...........-----..--.......---..
                                                                        ....  .       ...                                       ................................ .
                                                                       .    .  ..  ..   .                                   . .................................
                                                                                   ..                                     ....................................
                                                               .......     ..  .      ..                               ......................................
                                                              .. .      .. . ..   ...  ..                         ........................................ .
                                                        ....   ... .     . .     ....                          .. .......  ..............................  .
                                                 ....     ...      ..      ..           ....           .. . ................................   ... .. .....
                                           ....     ...        ... ..   .  .. .   ...             ....  ... .................................     .
                                      .....  ......       .....       .   ..  .. .   ..................... ................................
                                  .... ......     .... ...    .        ...  ...- .   .. ....  ... ... .....  .............................
                                ..    ..   ......             .      .. .   .. .    .-  . . ..... . ....  ..  .........................
                               ... ...                         .....   .      ..   . . ..... ..   ..     ....  -........... . ...
                          ...                     .  ...  ...  .... . . ..  .  -  .............     ...  ...   -.... ......... ....
                      ....                     . ...          .      ...   .. .  .                .     .     .  ...  .......... ..
                 .....                        .......   .     ...........   . .  ..            ..        .  ..   -  .. ..........
             ....                           ..........  .   ....  .   .   . .... . .        ...                 .     .......
           ..                               .  ....        .   .  ....   . ..     . ..  ... ..       ..       ..        ..
        ..                                          .    ..... .. . .   . .        .  ......                            ...
     ..                                                 .          ..  ..        .  ..      .                             . .
   .                                                   ...  ...       ..  .....   .     ..  .                 .             .. .
                                                       -.. ........  .. . .........        .                  .              ..
                                                       ..  .. .  .  ..           .        .  . .             .                ...
                                                      ......  .  .. .           .         .  ..            ..                    .
                                                     .. ..     .    .                      .  ....         .                      ..
                                                   ..    .... . . . .          .            .. .     ....                         .  .
                                                  .      ..    .               -              ......  . .                          .   . ...
                                                 .       .. ...... .                             ..  .. .. .                        .      ..
                                               ..        ..    ..  .            .                 .   . ... .                       ..
                                             ..           .... .                 .              .     . .  .                          .
                                            .         ..  ..    ..                ..            .      . .    .   .                    .
                                         .           .     ......                   .           .       . .         .                   .
     .                       . .       ..          .       ..                        .          .  .    .            .                  .   ...      .
                                      .  ..     ..         ...                        .               .                ......   ..      ..
                                     ..    .. .            ..    ...       .           ..       . .    ...  .            .    ... ..     .
                                     .      .              .. .    .                    ..      . .        ..            .......   ..     .
                                    .     ..                .    ...                      ..      .     .   ..          .     .      ..    ..
               .                   .    ..                  .   ....     .                  .      .     .. ....         ..   .       ..    .
      .             .             .    .                     .            .                   .    .       . ..  .         ..           ..   .              ..  .  .
                                .     . .      .              .     .                           .   .        ..    ...        .           ..  .   ..                .
                             .  .    .                         .    -                    ...    .    .          .    ....      .           .    .                  ..
                            .   .   .             .            ..   ..                  .        ..              .    .. ..     .          .     .
                            ..   . .        .   .               .    .                      .      .. .           .. . .   ....  .          .    ..
          .                  ..  . .                             .    .                   .          . ..          ..   .      .  ..          .   ..         ...         .
                              ..  ...                        ..  .     .        ...                   .  .           ...        .    .           .                     .
      .                        .    .                  .          ...    .. .                         .    .        .            .     . .                    .
                   .             ....    .                       .        .   ..                          . .                     .       .                       .
         .  .                     .                                  ...........                     . .                              ...                              .   `;

  for (const line of art.split("\n")) {
    console.log(c.white(line));
  }
  console.log(c.purple("  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────"));

  const title = `      _..._       .-'''-.                                                                                               .-'''-.
    .-'_..._''.   '   _    \\                                                                            _______         '   _    \\
  .' .'      '.\\\/   /\` '.   \\    _..._                  __.....__                                       \\  ___ \`'.    /   /\` '.   \\
 / .'          .   |     \\  '  .'     '.            .-''         '.                                      ' |--.\  \\  .   |     \\  '
. '            |   '      |  '.   .-.   .     .|   /     .-''"'-.  \`.                     .|             | |    \\  ' |   '      |  '.-,.--.
| |            \\    \\     / / |  '   '  |   .' |_ /     /________\\   \\ ____     _____   .' |_     __     | |     |  '\\    \\     / / |  .-. |
| |             \`.   \` ..' /  |  |   |  | .'     ||                  |\`.   \\  .'    / .'     | .:--.'.   | |     |  | \`.   \` ..' /  | |  | |
. '                '-...-'\`   |  |   |  |'--.  .-'\\    .-------------'  \`.  \`'    .' '--.  .-'/ |   \\ |  | |     ' .'    '-...-'\`   | |  | |
 \\ '.          .              |  |   |  |   |  |   \\    '-.____...---.    '.    .'      |  |  \`" __ | |  | |___.' /'                | |  '-
  '. \`._____.-'/              |  |   |  |   |  |    \`.             .'     .'     \`.     |  |   .'.''| | /_______.'/                 | |
    \`-.______ /               |  |   |  |   |  '.'    \`''-...... -'     .'  .'\`.   \`.   |  '.'/ /   | |_\\_______|/                  | |
             \`                |  |   |  |   |   /                     .'   /    \`.   \`. |   / \\ \\._,\\ '/                            |_|
                              '--'   '--'   \`'-'                     '----'       '----'\`'-'   \`--'  \`"`;

  for (const line of title.split("\n")) {
    console.log(c.lpurple(line));
  }

  const subtitle = `▗▖   ▄   ▄     ▗▖  ▗▖▄ ▗▞▀▚▖▄   ▄      ▗▄▖ ▗▄▄▄▖
▐▌   █   █     ▐▌  ▐▌▄ ▐▛▀▀▘█ ▄ █     ▐▌ ▐▌  █
▐▛▀▚▖ ▀▀▀█     ▐▌  ▐▌█ ▝▚▄▄▖█▄█▄█     ▐▛▀▜▌  █
▐▙▄▞▘▄   █      ▝▚▞▘ █                ▐▌ ▐▌▗▄█▄▖
      ▀▀▀`;

  console.log(c.purple("  ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────"));

  for (const line of subtitle.split("\n")) {
    console.log(c.gray(line));
  }

  console.log("");
  console.log(`  ${BOLD}${PURPLE}◆${RESET} ${BOLD}Contextador${RESET} ${GRAY}— by View AI${RESET}`);
  console.log(`  ${DIM}Codebase context for AI agents${RESET}`);
  console.log("");
}

export function bannerCompact() {
  console.log("");
  console.log(`  ${c.bpurple("◆")} ${c.bold("Contextador")} ${c.gray("— by View AI")}`);
  console.log("");
}

export function success(msg: string) {
  console.log(`  ${c.green("✓")} ${msg}`);
}

export function error(msg: string) {
  console.log(`  ${c.red("✗")} ${msg}`);
}

export function warn(msg: string) {
  console.log(`  ${c.yellow("!")} ${msg}`);
}

export function info(msg: string) {
  console.log(`  ${c.purple("›")} ${msg}`);
}

export function step(msg: string) {
  process.stdout.write(`  ${c.purple("→")} ${msg} `);
}

export function stepDone() {
  console.log(c.green("✓"));
}

export function stepFail(detail?: string) {
  console.log(c.red("✗") + (detail ? ` ${c.gray(detail)}` : ""));
}

export function heading(msg: string) {
  console.log(`\n  ${c.bpurple("───")} ${c.bold(msg)} ${c.bpurple("───")}\n`);
}

export function stat(label: string, value: string | number, color?: "green" | "red" | "yellow" | "purple") {
  const colorFn = color ? c[color] : c.white;
  console.log(`  ${c.gray(label.padEnd(22))} ${colorFn(String(value))}`);
}

export function divider() {
  console.log(`  ${c.dim("─".repeat(45))}`);
}
