"""Static shell subset, not a shell evaluator or an arbitrary-code sandbox."""
from pathlib import Path
import re

SHELLS = {"sh", "bash", "dash", "zsh", "ksh"}
SIGNALLERS = {"kill", "pkill", "killall", "fuser"}


def is_dynamic(value: str) -> bool:
    return bool(re.search(r"\$(?:[A-Za-z_({!@*?0-9])|`", value))


def _tokens(text: str) -> list[tuple[str, bool]]:
    """Keep operator provenance: a quoted ';' argument is not a command separator."""
    tokens, word = [], []
    quote, started, index = None, False, 0
    while index < len(text):
        char = text[index]
        if char == "\\" and quote != "'" and index + 1 < len(text):
            following = text[index + 1]
            if quote == '"' and following not in '$`"\\\n':
                word.append(char)
                index += 1
                continue
            if following != "\n":
                word.append(following)
                started = True
            index += 2
            continue
        if quote:
            if char == quote:
                quote = None
            else:
                word.append(char)
        elif char in "'\"":
            quote, started = char, True
        elif char == "#" and not started:
            index = text.find("\n", index)
            if index < 0:
                break
            continue
        elif char in " \t\r\n;&|()<>":
            if started:
                tokens.append(("".join(word), False))
                word, started = [], False
            if char in "\n;&|()<>":
                end = index + 1
                while char != "\n" and end < len(text) and text[end] == char:
                    end += 1
                tokens.append((text[index:end], True))
                index = end
                continue
        else:
            word.append(char)
            started = True
        index += 1
    if quote:
        raise ValueError("unterminated shell quote")
    if started:
        tokens.append(("".join(word), False))
    return tokens


def _without_heredoc_data(command: str) -> tuple[str, list[str]]:
    lines = command.splitlines(keepends=True)
    visible, executable = [], []
    index = 0
    while index < len(lines):
        header = lines[index]
        visible.append(header)
        index += 1
        try:
            tokens = _tokens(header)
        except ValueError:
            continue
        # Only real redirection operators, not an '<<EOF' string in documentation.
        for position, (token, operator) in enumerate(tokens[:-1]):
            if token != "<<" or not operator:
                continue
            marker = tokens[position + 1][0]
            tabs, delimiter = marker.startswith("-"), marker.removeprefix("-")
            if not re.fullmatch(r"[\w-]+", delimiter):
                continue
            body = []
            while index < len(lines):
                line = lines[index]
                index += 1
                if line.strip("\t\r\n" if tabs else "\r\n") == delimiter:
                    break
                body.append(line)
            prefix = []
            for value, is_operator in tokens[:position]:
                if is_operator and value in {";", "&&", "||", "|", "&"}:
                    prefix = []
                else:
                    prefix.append(value)
            prefix = unwrap(prefix)
            if prefix and Path(prefix[0]).name in SHELLS and all(value in {"-s", "--"} for value in prefix[1:]):
                executable.append("".join(body))
    return "".join(visible), executable


def unwrap(tokens: list[str]) -> list[str]:
    """Peel common literal wrappers; unknown options remain outside the supported subset."""
    tokens = list(tokens)
    while tokens:
        name = Path(tokens[0]).name
        if re.match(r"^[A-Za-z_]\w*=", tokens[0]):
            tokens.pop(0)
        elif name in {"command", "builtin", "exec", "nohup"}:
            tokens.pop(0)
            if tokens and tokens[0] == "--":
                tokens.pop(0)
        elif name in {"sudo", "env", "nice"}:
            tokens.pop(0)
            takes_value = {"sudo": {"-u", "-g", "--user", "--group"},
                           "env": {"-u", "--unset"}, "nice": {"-n", "--adjustment"}}[name]
            while tokens and (tokens[0].startswith("-") or re.match(r"^\w+=", tokens[0])):
                flag = tokens.pop(0)
                if flag in takes_value and tokens:
                    tokens.pop(0)
        elif name == "timeout":
            tokens.pop(0)
            while tokens and tokens[0].startswith("-"):
                flag = tokens.pop(0)
                if flag in {"-s", "-k", "--signal", "--kill-after"} and tokens:
                    tokens.pop(0)
            if tokens:
                tokens.pop(0)  # duration, not an imposed timeout
        else:
            break
    return tokens


def static_commands(command: str, depth: int = 0) -> list[list[str]]:
    """Find literal simple commands, including quoted shell -c and shell heredocs."""
    if depth > 5:
        return []
    visible, scripts = _without_heredoc_data(command)
    groups, group = [], []
    try:
        for token, operator in _tokens(visible):
            if operator and all(char in ";&|()\n" for char in token):
                if group:
                    groups.append(unwrap(group))
                group = []
            else:
                group.append(token)
        if group:
            groups.append(unwrap(group))
    except ValueError:
        return []  # unknown syntax is not evidence of an actual signal command
    result = []
    for tokens in groups:
        if not tokens:
            continue
        # Control keywords can precede a simple command in a block.
        while tokens and tokens[0] in {"then", "do", "else", "if", "!", "{"}:
            tokens = tokens[1:]
        if not tokens:
            continue
        name = Path(tokens[0]).name
        if name in SHELLS:
            flag = next((i for i, part in enumerate(tokens[1:], 1) if re.fullmatch(r"-[a-zA-Z]*c[a-zA-Z]*", part)), None)
            if flag is not None and flag + 1 < len(tokens):
                scripts.append(tokens[flag + 1])
        elif name == "eval" and len(tokens) == 2:
            scripts.append(tokens[1])
        else:
            result.append(tokens)
    for script in scripts:
        result.extend(static_commands(script, depth + 1))
    return result


def skill_reads(command: str, cwd: Path) -> list[Path]:
    """Recognize read commands, not echo/grep/catalog mentions or script execution."""
    found = []
    for tokens in static_commands(command):
        name = Path(tokens[0]).name
        if name == "cd" and len(tokens) == 2 and not is_dynamic(tokens[1]):
            cwd = (cwd / tokens[1]).resolve()
        if name not in {"cat", "head", "tail", "sed", "nl", "less", "more"}:
            continue
        if name == "sed" and any(arg.startswith(("-i", "--in-place")) for arg in tokens[1:]):
            continue
        if any(token in {">", ">>", ">&"} and (index == 0 or tokens[index - 1] != "2")
               for index, token in enumerate(tokens)):
            continue  # creation/output redirection is not a model-visible skill read
        for token in tokens[1:]:
            if Path(token).name == "SKILL.md" and not is_dynamic(token):
                found.append(cwd / Path(token).expanduser())
    return found