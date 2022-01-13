var message = [
    'This application is currently offline. We will be back soon.',
    'Cette application est actuellement hors ligne. Nous serons de retour bientôt.',
    'هذا التطبيق غير متصل حاليًا. سوف نعود قريب',
    'Esta aplicación está actualmente fuera de línea. Volveremos pronto',
    'Questa applicazione è attualmente offline. Torneremo presto.',
    '这个应用程式目前离线。 我们将很快回来。',
    'Diese Anwendung ist derzeit offline. Wir werden bald zurück sein.',
    'Ĉi tiu apliko estas nuntempe senreta. Ni revenos baldaŭ.',
    'Este aplicativo está atualmente offline. Voltaremos em breve.',
    'יישום זה אינו פעיל במצב לא מקוון. נחזור בקרוב.',
    'このアプリケーションは現在オフラインです。 すぐに戻ってきます。',
    'Deze applicatie is momenteel offline. We zullen snel terug zijn.',
    'Это приложение в настоящее время не в сети. Мы скоро вернемся.'
];
function animateCSS(element, animationName, callback) {
    const node = element;
    var aa = animationName.split(' ');
    for (var i = 0; i < aa.length; i++) node.classList.add('animated', aa[i]);

    function handleAnimationEnd() {
        for (var i = 0; i < aa.length; i++) node.classList.remove('animated', aa[i]);
        node.removeEventListener('animationend', handleAnimationEnd)

        if (typeof callback === 'function') callback()
    }

    node.addEventListener('animationend', handleAnimationEnd)
}
var display_me = function (ndx) {
    if (!message[ndx]) ndx = 0;
    var msg = document.getElementById('msg');
    msg.innerHTML = '<big><big>' + message[ndx] + '</big></big>';
    animateCSS(msg, 'fadeInRightBig', function () {
        setTimeout(function () {
            animateCSS(msg, 'fadeOutLeftBig', function () {

                display_me(ndx + 1);

            });
        }, 2000);
    });
};
display_me(Math.floor(Math.random() * message.length));
var tom = function () {

    var xhr = new XMLHttpRequest();
    xhr.open('GET', location.href + '/guru-29c7548b-3cbf-4c20-93c6-8b489b93cce0');
    xhr.onreadystatechange = function (oEvent) {
        if (xhr.readyState === 4) {
            if (xhr.status === 200) {
                setTimeout(tom, 2000);
            } else {
                location.href = "/";
            }
        }
    };

    xhr.send();

};
setTimeout(tom, 2000);

window.onerror = function (msg, url, lineNo, columnNo, error) {
    console.log('error');
    location.href = location.href;
    return false;
}