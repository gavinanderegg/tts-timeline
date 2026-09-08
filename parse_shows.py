import argparse
import html
import json
import re
import sys
from datetime import date


BASE_URL = "https://daringfireball.net"

WEEKDAYS = {
    "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
    "mon", "tue", "tues", "wed", "thu", "thur", "thurs", "fri", "sat", "sun",
}

MONTHS = {
    "january": 1, "february": 2, "march": 3, "april": 4,
    "may": 5, "june": 6, "july": 7, "august": 8,
    "september": 9, "october": 10, "november": 11, "december": 12,
    "jan": 1, "feb": 2, "mar": 3, "apr": 4,
    "jun": 6, "jul": 7, "aug": 8,
    "sep": 9, "sept": 9, "oct": 10, "nov": 11, "dec": 12,
}


def html_to_text(fragment):
    without_tags = re.sub(r"<[^>]+>", "", fragment)
    decoded = html.unescape(without_tags)
    return re.sub(r"\s+", " ", decoded).strip()


def parse_dateline(text):
    cleaned = html.unescape(text).strip()
    cleaned = re.sub(r"\s+\d{1,2}:\d{2}:\d{2}\s+[A-Za-z]{2,4}$", "", cleaned)
    parts = cleaned.replace(",", " ").split()

    if parts and parts[0].lower().rstrip(".") in WEEKDAYS:
        parts.pop(0)

    if len(parts) != 3:
        return None

    first, second, year = parts
    if first.lower() in MONTHS:
        month, day = MONTHS[first.lower()], second
    elif second.lower() in MONTHS:
        month, day = MONTHS[second.lower()], first
    else:
        return None

    try:
        return date(int(year), month, int(day))
    except ValueError:
        return None


def find_episode_links(heading_html):
    pairs = re.findall(
        r'<a\s+href="([^"]*/thetalkshow/[^"]*)"[^>]*>(.*?)</a>',
        heading_html,
        re.S,
    )
    return [(url, html_to_text(text)) for url, text in pairs]


def titles_for_heading(heading_html, links):
    if len(links) == 1:
        return [links[0][1]]

    before_first_link = heading_html.split("<a", 1)[0]
    shared_title = html_to_text(before_first_link).rstrip(":").strip()
    return ["%s: %s" % (shared_title, link_text) for _, link_text in links]


def absolute_url(url):
    if url.startswith("http://") or url.startswith("https://"):
        return url
    return BASE_URL + url


def parse_episodes(source):
    episodes = []
    problems = []

    blocks = re.split(r"(?=<h2>)", source)

    for block in blocks:
        heading_match = re.search(r"<h2>(.*?)</h2>", block, re.S)
        if heading_match is None:
            continue

        heading_html = heading_match.group(1)
        plain_heading = html_to_text(heading_html)

        dateline_match = re.search(r'<h6[^>]*>(.*?)</h6>', block, re.S)
        if dateline_match is None:
            problems.append("No dateline found for: %s" % plain_heading)
            continue

        episode_date = parse_dateline(dateline_match.group(1))
        if episode_date is None:
            problems.append(
                "Unrecognized dateline %r for: %s"
                % (html_to_text(dateline_match.group(1)), plain_heading)
            )
            continue

        paragraphs = re.findall(r"<p>(.*?)</p>", block, re.S)
        description = " ".join(
            html_to_text(paragraph) for paragraph in paragraphs
        ).strip()
        if not description:
            problems.append("No description found for: %s" % plain_heading)

        links = find_episode_links(heading_html)
        if not links:
            problems.append("No episode link found for: %s" % plain_heading)
            continue

        titles = titles_for_heading(heading_html, links)
        for title, (url, _link_text) in zip(titles, links):
            episodes.append({
                "date": episode_date.isoformat(),
                "title": title,
                "url": absolute_url(url),
                "description": description,
            })

    episodes.sort(key=lambda episode: (episode["date"], episode["title"]))
    return episodes, problems


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "input", nargs="?", default="shows.txt",
        help="File to parse (default: shows.txt)",
    )
    parser.add_argument(
        "-o", "--output", default="episodes.json",
        help="JSON file to write (default: episodes.json)",
    )
    args = parser.parse_args()

    with open(args.input, encoding="utf-8") as source_file:
        source = source_file.read()

    episodes, problems = parse_episodes(source)

    for problem in problems:
        print("WARNING: %s" % problem, file=sys.stderr)

    with open(args.output, "w", encoding="utf-8") as output_file:
        json.dump(episodes, output_file, indent=2, ensure_ascii=False)
        output_file.write("\n")

    print("Wrote %d episodes to %s" % (len(episodes), args.output))
    if problems:
        print("%d entries had problems (see warnings above)." % len(problems),
              file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
