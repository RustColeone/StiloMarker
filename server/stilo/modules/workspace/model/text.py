"""Text offsets as the browser counts them: UTF-16 code units."""


def utf16_length(text: str) -> int:
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def utf16_index(text: str, offset: int) -> int:
    """The Python index of a browser offset; refuses one that splits a surrogate pair."""
    units = 0
    for index, char in enumerate(text):
        if units == offset:
            return index
        units += 2 if ord(char) > 0xffff else 1
        if units > offset:
            raise ValueError("Text patch range splits a Unicode character")
    if units == offset:
        return len(text)
    raise ValueError("Text patch range exceeds content length")
