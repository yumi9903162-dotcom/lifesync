self.addEventListener("notificationclick",function(event){
  event.notification.close();
  var target=(event.notification.data&&event.notification.data.url)||"./index.html";
  event.waitUntil(clients.matchAll({type:"window",includeUncontrolled:true}).then(function(list){
    for(var i=0;i<list.length;i++){
      if("focus" in list[i]){
        list[i].postMessage({type:"lifesync-notification-click",key:event.notification.data&&event.notification.data.key});
        return list[i].focus();
      }
    }
    return clients.openWindow?clients.openWindow(target):null;
  }));
});
