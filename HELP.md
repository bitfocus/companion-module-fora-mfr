## For.A MFR Series 3G/HD/SD/ASI Routing Switchers

## Commands available by connecting using LAN

 Control command list
 
Commands (S?) for requesting the crosspoints list

    - Control command   =>  @[sp]S?<Lvl>
    - Command response  <=  S:<Lvl><Dest>,<Src>
 
Commands (X?) for requesting information on crosspoints (by specifying a destination and level.)

    - Control command   =>  @[sp]X?<Lvl><Dest>
    - Command response  <=  S:<Lvl><Dest>,<Src>

Commands (X:) for switching over a crosspoint (single channel)

    - Control command   =>  @[sp]X:<Lvls>/<Dest>,<Src>
    - Command response  <=  S:<Lvl><Dest>,<Src>
                        <=  C:<Lvls>/<Dest>,<Src>[.....[S<Salvo number>][L<Link number>]]:I<ID>

 Commands for switching over crosspoints (multi-channel simultaneous switchover)

    - Control command 
        Clear a preset crosspoint.  =>  @[sp]B:C        
    - Command response

    - Control command 
        Preset a crosspoint.    =>  @[sp]P:<Lvl>/<Dest>,<Src>     
    - Command response
 
    - Control command 
        Read a preset crosspoint specifying a level and destination.    =>  @[sp]P?<Lvl><Dest>    
    - Command response  <=  V:<Lvl><Dest>,<Src>

    - Control command 
        Read preset crosspoints for all channels in the specified level.    =>  @[sp]V?<Lvl>    
    - Command response  <=  V:<Lvl><Dest>,<Src>

    - Control command 
        Perform the preset crosspoints simultaneously.  =>  @[sp]B:E 
    - Command response  <=  S:<Lvl><Dest>,<Src>
                        <=  C:<Lvls>/<Dest>,<Src>[.....[S<Salvo number>][L<Link number>]]:I<ID>

Commands (W:) for locking a destination

    - Control command 
        LOCK ALL units. =>  @[sp]W:<Lvl>/<Dest>,<ID>,1
    - Command response
                        <=  W!<Lvl><Dest>,<ID>,1
    
    - Control command 
        LOCK OTHER units.   =>  @[sp]W:<Lvl>/<Dest>,<ID>,2
    - Command response
                        <=  W!<Lvl><Dest>,<ID>,2

    - Control command 
        Disable LOCK.   =>  @[sp]W:<Lvl>/<Dest>,<ID>,0
    - Command response
                        <=  W!<Lvl><Dest>,<ID>,0

Commands (K?) for requesting input/output channel names

    - Control command   =>  @[sp]K?<SorD><AorK>,<Ofset>
    - Command response  <=  K:<SorD><AorK><No.>,<Dat>
 
Commands (A?) for requesting CPU status.

    - Control command   =>  @[sp]A?
    - Command response  
        If CPU is active:   <=  @[sp]A:<ID>
        If CPU is passive:  <= (no response) 
 
Commands (W?) for requesting Destination Lock status.

    - Control command   =>  @[sp]W?<Lvl>,<Dest>
    - Command response  <=  W!<Lvl><Dest>,<ID>,0-2* 
                            *0: Nothing locked
                            1: LOCK ALL
                            2: LOCK OTHER
 
 
*1 When commands are sent via LAN, an Echo, Prompt, S response and other response messages may be included in a single packet or divided into two or more packets. Therefore, do not process commands in a per packet basis but a per stream basis.

*2 A command protocol should be selected in the [Web-based Control: Port Settings page]. 
 
**Available commands in this module**

* Send TCP
* Send UDP