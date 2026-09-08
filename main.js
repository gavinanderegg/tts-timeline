// The Talk Show Timeline — one calendar heatmap per year, built from episodes.json.

const SURFACE = '#222222';
const EMPTY_CELL = '#2e2e2e';
const INK = '#EEE';
const INK_MUTED = '#CCC';
const INK_FAINT = '#AAA';

const RAMP = ['#3d8fb0', '#AEF'];

// Layout constants, in pixels.
const WEEKS_PER_YEAR = 53;
const DAYS_PER_WEEK = 7;
const LEFT_GUTTER = 64;    // Room for the year label.
const RIGHT_GUTTER = 92;  // Room for the per-year total.
const TOP_MARGIN = 80;     // Room for the legend, plus a gap below it.
const BOTTOM_MARGIN = 32;
const YEAR_GAP = 64;       // Vertical space between one year and the next.
const MIN_CELL = 9;
const MAX_CELL = 18;

// Offset from the pointer, shared by the hover tooltip and the pinned card so
// both sit the same distance away, and the margin each keeps from the edge.
const BOX_GAP = 14;
const BOX_EDGE = 8;

const container = document.getElementById('chart');

fetch('./episodes.json')
    .then((response) => response.json())
    .then((episodes) => start(episodes))
    .catch((error) => showLoadError(error));

function showLoadError(error) {
    container.style.color = INK;
    container.style.padding = '2rem';
    container.style.lineHeight = '1.5';
    container.textContent =
        'Could not load episodes.json (' + error.message + '). ';
}

function start(episodes) {
    const byDate = groupByDate(episodes);
    const years = listYears(episodes);
    const countsByYear = countByYear(episodes);

    const heatData = Array.from(byDate.entries()).map(
        ([date, dayEpisodes]) => [date, dayEpisodes.length]
    );

    const chart = echarts.init(container, null, { renderer: 'canvas' });

    function render() {
        const cellSize = pickCellSize(container.clientWidth);
        const yearHeight = DAYS_PER_WEEK * cellSize;

        container.style.height =
            (TOP_MARGIN + years.length * (yearHeight + YEAR_GAP) + BOTTOM_MARGIN) + 'px';
        chart.resize();

        chart.setOption(
            buildOption(years, countsByYear, heatData, byDate, cellSize, yearHeight),
            true
        );
    }

    render();
    setupCard(chart, byDate);

    window.addEventListener('resize', () => {
        hideCard();
        render();
    });
}

// --- the pinned detail card -------------------------------------------------

const card = document.getElementById('episode-card');
const cardBody = card.querySelector('.card-body');

let clickOpenedCard = false;
let chartInstance = null;

function setupCard(chart, byDate) {
    chartInstance = chart;

    chart.on('click', 'series', (params) => {
        const dayEpisodes = byDate.get(params.value[0]);
        if (!dayEpisodes) {
            return;
        }
        clickOpenedCard = true;
        showCard(dayEpisodes, params.event.event);
    });

    card.querySelector('.card-close').addEventListener('click', hideCard);

    document.addEventListener('click', (event) => {
        if (clickOpenedCard) {
            clickOpenedCard = false;
            return;
        }
        if (!card.contains(event.target)) {
            hideCard();
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            hideCard();
        }
    });
}

function showCard(dayEpisodes, nativeEvent) {
    cardBody.innerHTML = cardHtml(dayEpisodes);

    card.style.left = '-9999px';
    card.style.top = '0px';
    card.hidden = false;

    positionCard(
        nativeEvent.clientX + window.scrollX,
        nativeEvent.clientY + window.scrollY
    );

    setTooltipEnabled(false);
}

function positionCard(pageX, pageY) {
    const GAP = BOX_GAP;
    const EDGE = BOX_EDGE;
    const width = card.offsetWidth;
    const height = card.offsetHeight;

    const viewportRight = window.scrollX + document.documentElement.clientWidth;
    const viewportBottom = window.scrollY + document.documentElement.clientHeight;

    let left = pageX + GAP;
    if (left + width > viewportRight - EDGE) {
        left = pageX - width - GAP;
    }
    left = Math.max(window.scrollX + EDGE, left);

    let top = pageY + GAP;
    if (top + height > viewportBottom - EDGE) {
        top = pageY - height - GAP;
    }
    top = Math.max(window.scrollY + EDGE, top);

    card.style.left = left + 'px';
    card.style.top = top + 'px';
}

// The same placement rules as positionCard, in the coordinates ECharts expects.
// Its `point` is relative to the chart container, which starts at the top of the
// page, so those coordinates and page coordinates are the same thing here.
function positionTooltip(point, size) {
    const boxWidth = size.contentSize[0];
    const boxHeight = size.contentSize[1];
    const containerWidth = size.viewSize[0];

    // The container is as tall as the whole page, so the bottom of the visible
    // area has to come from the window rather than from viewSize.
    const viewportBottom = window.scrollY + document.documentElement.clientHeight;

    let x = point[0] + BOX_GAP;
    if (x + boxWidth > containerWidth - BOX_EDGE) {
        x = point[0] - boxWidth - BOX_GAP;
    }
    x = Math.max(BOX_EDGE, x);

    let y = point[1] + BOX_GAP;
    if (y + boxHeight > viewportBottom - BOX_EDGE) {
        y = point[1] - boxHeight - BOX_GAP;
    }
    y = Math.max(window.scrollY + BOX_EDGE, y);

    return [x, y];
}

function hideCard() {
    card.hidden = true;
    setTooltipEnabled(true);
}

function setTooltipEnabled(enabled) {
    if (chartInstance === null) {
        return;
    }
    if (!enabled) {
        chartInstance.dispatchAction({ type: 'hideTip' });
    }

    chartInstance.setOption({ tooltip: { show: enabled } });
}

// Builds the inner contents shared by the hover tooltip and the pinned card.
// Only the pinned card links its titles, since a tooltip cannot be clicked.
function detailHtml(dayEpisodes, withLinks) {
    const dateLine =
        '<div class="card-date">' +
        escapeHtml(formatDate(dayEpisodes[0].date)) +
        '</div>';

    const blocks = dayEpisodes.map((episode) => {
        const title = escapeHtml(episode.title);
        const titleHtml = withLinks
            ? '<a href="' + escapeHtml(episode.url) + '" target="_blank" rel="noopener noreferrer">' +
              title + '</a>'
            : title;

        return '<div class="card-title">' + titleHtml + '</div>' +
            '<div class="card-description">' +
            escapeHtml(episode.description) +
            '</div>';
    });

    return dateLine + blocks.join('<div class="card-separator"></div>');
}

function cardHtml(dayEpisodes) {
    return detailHtml(dayEpisodes, true);
}

// --- shaping the data -------------------------------------------------------

function groupByDate(episodes) {
    const byDate = new Map();
    episodes.forEach((episode) => {
        if (!byDate.has(episode.date)) {
            byDate.set(episode.date, []);
        }
        byDate.get(episode.date).push(episode);
    });
    return byDate;
}

function listYears(episodes) {
    const years = new Set();
    episodes.forEach((episode) => years.add(episode.date.slice(0, 4)));
    return Array.from(years).sort();
}

function countByYear(episodes) {
    // Counts episodes, not days, so the two-part show on 2014-07-19 counts twice.
    const counts = new Map();
    episodes.forEach((episode) => {
        const year = episode.date.slice(0, 4);
        counts.set(year, (counts.get(year) || 0) + 1);
    });
    return counts;
}

function pickCellSize(containerWidth) {
    const usableWidth = containerWidth - LEFT_GUTTER - RIGHT_GUTTER;
    const fitted = Math.floor(usableWidth / WEEKS_PER_YEAR);
    return Math.max(MIN_CELL, Math.min(MAX_CELL, fitted));
}

function topOfYear(index, yearHeight) {
    return TOP_MARGIN + index * (yearHeight + YEAR_GAP);
}

// --- building the chart -----------------------------------------------------

function buildOption(years, countsByYear, heatData, byDate, cellSize, yearHeight) {
    const calendars = years.map((year, index) => ({
        top: topOfYear(index, yearHeight),
        left: LEFT_GUTTER,
        right: RIGHT_GUTTER,
        range: year,
        cellSize: [cellSize, cellSize],
        splitLine: {
            show: true,
            lineStyle: {
                color: '#000',
                width: 3,
                type: 'solid'
            }
        },
        itemStyle: {
            color: EMPTY_CELL,
            borderWidth: 2,
            borderColor: SURFACE
        },
        yearLabel: {
            show: true,
            position: 'left',
            margin: 24,
            color: INK,
            fontSize: 15,
            fontWeight: 'bold'
        },
        monthLabel: {
            show: true,
            color: INK_FAINT,
            fontSize: 10,
            margin: 6
        },
        dayLabel: {
            show: true,
            firstDay: 1,
            color: INK_FAINT,
            fontSize: 9,
            margin: 4,
            nameMap: ['S', 'M', 'T', 'W', 'T', 'F', 'S']
        }
    }));

    const series = years.map((year, index) => ({
        type: 'heatmap',
        coordinateSystem: 'calendar',
        calendarIndex: index,
        data: heatData.filter((entry) => entry[0].startsWith(year)),
        itemStyle: {
            borderWidth: 2,
            borderColor: SURFACE
        },
        emphasis: {
            itemStyle: {
                borderColor: '#ffffff',
                borderWidth: 2
            }
        }
    }));

    const yearTotals = years.map((year, index) => ({
        type: 'text',
        right: 28,
        top: topOfYear(index, yearHeight) + yearHeight / 2,
        style: {
            text: '{count|' + countsByYear.get(year) + '}\n{unit|episodes}',
            rich: {
                count: { fontSize: 20, fontWeight: 'bold', fill: INK, align: 'right' },
                unit: { fontSize: 11, fill: INK_MUTED, align: 'right', padding: [3, 0, 0, 0] }
            },
            textAlign: 'right',
            textVerticalAlign: 'middle'
        }
    }));

    return {
        backgroundColor: SURFACE,
        tooltip: {
            trigger: 'item',
            // ECharts' own box is switched off so the .detail-box class alone
            // decides the size, padding, and border — the same ones the card uses.
            backgroundColor: 'transparent',
            borderWidth: 0,
            padding: 0,
            extraCssText: 'box-shadow: none; white-space: normal;',
            // ECharts' default cursor offset is larger than BOX_GAP, which left
            // the tooltip sitting further from the pointer than the card. Placing
            // it by hand keeps the two identical.
            position: (point, params, dom, rect, size) => positionTooltip(point, size),
            formatter: (params) => {
                const dayEpisodes = byDate.get(params.value[0]);
                if (!dayEpisodes) {
                    return '';
                }
                return '<div class="detail-box">' + detailHtml(dayEpisodes, false) + '</div>';
            }
        },
        visualMap: {
            type: 'piecewise',
            orient: 'horizontal',
            left: LEFT_GUTTER,
            top: 16,
            itemWidth: 12,
            itemHeight: 12,
            itemGap: 14,
            showLabel: true,
            pieces: [
                { value: 1, label: '1 episode', color: RAMP[0] },
                { value: 2, label: '2 episodes', color: RAMP[1] }
            ],
            textStyle: { color: INK_MUTED, fontSize: 11 }
        },
        calendar: calendars,
        series: series,
        graphic: yearTotals
    };
}

function formatDate(isoDate) {
    const parts = isoDate.split('-');
    const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    return date.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });
}

function escapeHtml(text) {
    return text
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
